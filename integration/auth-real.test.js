import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from 'redis';
import { startSecureServer, testSecret, origin } from './support/secure.js';

const cookieFrom = response => response.headers.get('set-cookie')?.split(';')[0];
const credentialError = { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } };
const identityKeys = ['display_name', 'role', 'user_id', 'username'];

function assertIdentity(body) {
  assert.deepEqual(Object.keys(body.data).sort(), identityKeys);
  assert.equal(typeof body.data.user_id, 'string');
}

test('real PostgreSQL/Redis auth, role authorization, Origin/CSRF and opaque session lifecycle', async t => {
  const ctx = await startSecureServer(t);
  const sessions = {};

  await t.test('health is public while the six original warehouse GET routes require a session', async () => {
    const health = await ctx.request('/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: 'ok', database: 'connected' });
    for (const path of ['/products', '/products/P3_A', '/inventory', '/inventory/P3_A', '/transactions', '/scan-points']) {
      const response = await ctx.request(path);
      assert.equal(response.status, 401, path);
      assert.equal(response.body.error.code, 'AUTHENTICATION_REQUIRED');
    }
  });

  await t.test('four roles login with real Argon2id hashes; identity JSON does not contain private fields', async () => {
    for (const [username, role] of [['p3_admin', 'ADMIN'], ['p3_keeper', 'KEEPER'], ['p3_staff', 'STAFF'], ['p3_viewer', 'VIEWER']]) {
      const response = await ctx.request('/auth/login', { method: 'POST', body: { username, password: testSecret(`${username}-password.txt`) } });
      assert.equal(response.status, 200);
      assertIdentity(response.body);
      assert.equal(response.body.data.role, role);
      const header = response.headers.get('set-cookie');
      assert.ok(header?.includes('; HttpOnly'), 'Session cookie must be HttpOnly.');
      assert.ok(header?.includes('; SameSite=Lax'), 'Session cookie must declare SameSite=Lax.');
      const cookie = cookieFrom(response);
      assert.ok(typeof cookie === 'string' && cookie.length > 43, 'Session cookie is missing.');
      const csrfResponse = await ctx.request('/auth/csrf', { cookie });
      assert.equal(csrfResponse.status, 200);
      assert.ok(typeof csrfResponse.body.data.csrf_token === 'string' && csrfResponse.body.data.csrf_token.length === 43);
      sessions[role] = { cookie, csrf: csrfResponse.body.data.csrf_token };
      const me = await ctx.request('/auth/me', { cookie });
      assert.equal(me.status, 200);
      assertIdentity(me.body);
      assert.equal(me.body.data.role, role);
      assert.equal((await ctx.request('/inventory', { cookie })).status, 200);
    }
  });

  await t.test('unknown, inactive, no-hash and wrong-password responses are identical and safe', async () => {
    const attempts = [
      { username: `missing_${randomUUID().slice(0, 8)}`, password: randomBytes(24).toString('base64url') },
      { username: 'p3_inactive', password: randomBytes(24).toString('base64url') },
      { username: 'p3_nohash', password: randomBytes(24).toString('base64url') },
      { username: 'p3_admin', password: randomBytes(24).toString('base64url') },
    ];
    for (const body of attempts) {
      const response = await ctx.request('/auth/login', { method: 'POST', body });
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, credentialError);
      assert.ok(!response.headers.has('set-cookie'));
    }
    const prerequisites = (await ctx.admin.query(`SELECT username,is_active,password_hash IS NULL AS hash_missing
      FROM public.users WHERE username IN ('p3_inactive','p3_nohash') ORDER BY username`)).rows;
    assert.equal(prerequisites.length, 2);
    assert.equal(prerequisites.find(row => row.username === 'p3_inactive').is_active, false);
    assert.equal(prerequisites.find(row => row.username === 'p3_nohash').hash_missing, true);
  });

  await t.test('Origin and CSRF are enforced before administrative mutation and client identity claims are rejected', async () => {
    const admin = sessions.ADMIN;
    const product = { product_id: `AUTH_${randomUUID().slice(0, 8)}`, product_name: 'Synthetic forbidden request', base_unit: 'item' };
    assert.equal((await ctx.request('/products', { method: 'POST', body: product, cookie: admin.cookie })).status, 403);
    assert.equal((await ctx.request('/products', { method: 'POST', body: product, cookie: admin.cookie,
      csrf: sessions.KEEPER.csrf })).status, 403);
    assert.equal((await ctx.request('/products', { method: 'POST', body: product, cookie: admin.cookie,
      csrf: admin.csrf, requestOrigin: 'http://untrusted.invalid' })).status, 403);
    assert.equal((await ctx.request('/auth/login', { method: 'POST', body: {
      username: 'p3_admin', password: testSecret('p3_admin-password.txt'), role: 'ADMIN', user_id: '1',
    } })).status, 400);
    assert.equal((await ctx.request('/auth/login', { method: 'POST', requestOrigin: 'http://untrusted.invalid', body: {
      username: 'p3_admin', password: testSecret('p3_admin-password.txt'),
    } })).status, 403);
    const missing = await ctx.db.query('SELECT count(*)::text AS count FROM public.products WHERE product_id=$1', [product.product_id]);
    assert.equal(missing.rows[0].count, '0');
  });

  await t.test('KEEPER/STAFF/VIEWER cannot administer users or catalog; STAFF IN and VIEWER OUT are forbidden', async () => {
    for (const role of ['KEEPER', 'STAFF', 'VIEWER']) {
      const session = sessions[role];
      assert.equal((await ctx.request('/users', { cookie: session.cookie, headers: { 'X-Role': 'ADMIN', 'X-User-Id': '1' } })).status, 403);
      assert.equal((await ctx.request('/products', { method: 'POST', body: { product_id: `AUTH_${randomUUID().slice(0, 8)}`,
        product_name: 'Synthetic forbidden product', base_unit: 'item' }, cookie: session.cookie, csrf: session.csrf })).status, 403);
    }
    for (const [role, movement] of [['STAFF', 'IN'], ['VIEWER', 'IN'], ['VIEWER', 'OUT']]) {
      const session = sessions[role];
      const response = await ctx.request('/transactions', { method: 'POST', cookie: session.cookie, csrf: session.csrf,
        body: { transaction_id: randomUUID(), scan_point_id: 'P3_GATE_A', scan_code: 'P3_A_ITEM', movement_type: movement, quantity_packages: 1 } });
      assert.equal(response.status, 403);
    }
  });

  await t.test('a successful login rotates the cookie and logout revokes it through real Redis', async () => {
    const first = sessions.ADMIN;
    const rotated = await ctx.request('/auth/login', { method: 'POST', cookie: first.cookie,
      body: { username: 'p3_admin', password: testSecret('p3_admin-password.txt') } });
    assert.equal(rotated.status, 200);
    const cookie = cookieFrom(rotated);
    assert.ok(cookie !== first.cookie, 'Login must rotate the opaque token.');
    assert.equal((await ctx.request('/auth/me', { cookie: first.cookie })).status, 401);
    const csrf = (await ctx.request('/auth/csrf', { cookie })).body.data.csrf_token;
    assert.equal((await ctx.request('/auth/logout', { method: 'POST', cookie })).status, 403);
    const logout = await ctx.request('/auth/logout', { method: 'POST', cookie, csrf });
    assert.equal(logout.status, 204);
    assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
    assert.equal((await ctx.request('/auth/me', { cookie })).status, 401);
    assert.equal((await ctx.request('/auth/logout', { method: 'POST', cookie })).status, 204);
  });
});

test('real user API password reset/role/status changes invalidate sessions through authoritative auth_version', async t => {
  const ctx = await startSecureServer(t);
  const admin = await ctx.login();
  const username = `auth_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const initialPassword = randomBytes(24).toString('base64url');
  const replacementPassword = randomBytes(24).toString('base64url');
  const create = await ctx.request('/users', { method: 'POST', cookie: admin.cookie, csrf: admin.csrf,
    body: { username, display_name: 'Synthetic auth lifecycle account', role: 'KEEPER', password: initialPassword } });
  assert.equal(create.status, 201);
  const id = create.body.data.user_id;
  assert.equal(typeof id, 'string');
  assert.ok(!Object.hasOwn(create.body.data, 'password_hash'));
  let inactive = false;
  t.after(async () => {
    if (!inactive) await ctx.request(`/users/${id}/status`, { method: 'PATCH', cookie: admin.cookie, csrf: admin.csrf, body: { is_active: false } });
  });
  const first = await ctx.login(username, initialPassword);
  const reset = await ctx.request(`/users/${id}/reset-password`, { method: 'POST', cookie: admin.cookie,
    csrf: admin.csrf, body: { password: replacementPassword } });
  assert.equal(reset.status, 200);
  assert.ok(!Object.hasOwn(reset.body.data, 'password_hash'));
  assert.equal((await ctx.request('/auth/me', { cookie: first.cookie })).status, 401);
  const old = await ctx.request('/auth/login', { method: 'POST', body: { username, password: initialPassword } });
  assert.equal(old.status, 401);
  assert.deepEqual(old.body, credentialError);
  const second = await ctx.login(username, replacementPassword);
  const roleChange = await ctx.request(`/users/${id}`, { method: 'PATCH', cookie: admin.cookie,
    csrf: admin.csrf, body: { role: 'VIEWER' } });
  assert.equal(roleChange.status, 200);
  assert.equal((await ctx.request('/auth/me', { cookie: second.cookie })).status, 401);
  const third = await ctx.login(username, replacementPassword);
  assert.equal(third.user.role, 'VIEWER');
  const status = await ctx.request(`/users/${id}/status`, { method: 'PATCH', cookie: admin.cookie,
    csrf: admin.csrf, body: { is_active: false } });
  assert.equal(status.status, 200);
  inactive = true;
  assert.equal((await ctx.request('/auth/me', { cookie: third.cookie })).status, 401);
  const disabled = await ctx.request('/auth/login', { method: 'POST', body: { username, password: replacementPassword } });
  assert.equal(disabled.status, 401);
  assert.deepEqual(disabled.body, credentialError);
});

test('real Redis Lua preserves idle expiry and an absolute lifetime despite activity', async t => {
  await t.test('idle session expires in Redis', async idle => {
    const ctx = await startSecureServer(idle, { idleMs: 300, absoluteMs: 2000 });
    const session = await ctx.login('p3_keeper');
    await delay(450);
    const expired = await ctx.request('/auth/me', { cookie: session.cookie });
    assert.equal(expired.status, 401);
  });
  await t.test('touching a session does not extend its absolute lifetime', async absolute => {
    const ctx = await startSecureServer(absolute, { idleMs: 1000, absoluteMs: 3000 });
    const session = await ctx.login('p3_keeper');
    for (let i = 0; i < 4; i++) {
      await delay(550);
      assert.equal((await ctx.request('/auth/me', { cookie: session.cookie })).status, 200);
    }
    await delay(1000);
    assert.equal((await ctx.request('/auth/me', { cookie: session.cookie })).status, 401);
  });
});

test('real Redis health ACL allows PING and rejects reading or writing session keys', async t => {
  // RESP2 and disabled client metadata prevent implicit HELLO/CLIENT commands.
  const client = createClient({ socket: { host: '127.0.0.1', port: 6379, connectTimeout: 3000, reconnectStrategy: false },
    username: 'warehouse_health', password: testSecret('redis-health-password.txt'), RESP: 2,
    maintNotifications: 'disabled', disableClientInfo: true, disableOfflineQueue: true });
  client.on('error', () => {});
  t.after(() => { if (client.isOpen) client.destroy(); });
  await client.connect();
  assert.equal(await client.ping(), 'PONG');
  await assert.rejects(client.get('ssw:p3:session:synthetic-acl-probe'), /NOPERM/u);
  await assert.rejects(client.set('ssw:p3:session:synthetic-acl-probe', 'forbidden'), /NOPERM/u);
});
