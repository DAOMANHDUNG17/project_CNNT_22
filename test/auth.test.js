import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { createAuth, hashPassword, verifyPassword, validateNewPassword } from '../src/auth/index.js';
import { createSessionStore, digest } from '../src/auth/sessions.js';
import { errorHandler } from '../src/middleware/error-handler.js';

// Contract double only. The real Redis suite must independently execute the Lua.
class MemoryRedis {
  constructor(clock = Date.now) { this.clock = clock; this.data = new Map(); this.failed = false; }
  get(key) {
    const item = this.data.get(key);
    if (!item || item.expires <= this.clock()) { this.data.delete(key); return null; }
    return item.value;
  }
  put(key, value, ttl = Infinity) { this.data.set(key, { value: String(value), expires: this.clock() + ttl }); return 'OK'; }
  async sendCommand(args) {
    if (this.failed) throw new Error('Synthetic unavailable session store');
    const [command, ...rest] = args;
    if (command === 'GET') return this.get(rest[0]);
    if (command === 'SET') return this.put(rest[0], rest[1], Number(rest[3]));
    if (command === 'DEL') return rest.reduce((count, key) => count + Number(this.data.delete(key)), 0);
    if (command !== 'EVAL') throw new Error(`Unexpected synthetic command ${command}`);
    const [script, count] = rest, n = Number(count), keys = rest.slice(2, n + 2), values = rest.slice(n + 2);
    if (script.includes('warehouse_login_rate_v1')) {
      return keys.map(key => {
        const previous = this.get(key), number = Number(previous ?? 0) + 1;
        if (previous === null) this.put(key, number, Number(values[0]));
        else this.data.get(key).value = String(number);
        return number;
      });
    }
    if (script.includes('warehouse_session_revoke_v1')) {
      const epoch = String(Number(this.get(keys[0]) ?? 0) + 1);
      this.put(keys[0], epoch, Number(values[0]));
      return epoch;
    }
    if (script.includes('warehouse_session_touch_v1')) {
      const raw = this.get(keys[0]);
      if (raw === null) return null;
      const session = JSON.parse(raw), now = Number(values[0]), idle = Number(values[1]);
      if (session.epoch !== (this.get(keys[1]) ?? '0') || now < session.issuedAt || now < session.lastSeen
          || now >= session.expiresAt || now - session.lastSeen >= idle) {
        this.data.delete(keys[0]); return null;
      }
      session.lastSeen = now;
      const touched = JSON.stringify(session);
      this.put(keys[0], touched, Math.min(idle, session.expiresAt - now));
      return touched;
    }
    throw new Error('Unexpected synthetic Lua script');
  }
}

const origin = 'http://127.0.0.1:3000';
const ephemeralPassword = randomBytes(24).toString('base64url');
const credential = await hashPassword(ephemeralPassword);

async function fixture(t, options = {}) {
  let time = 100000;
  const redis = new MemoryRedis(() => time);
  const users = ['ADMIN', 'KEEPER', 'STAFF', 'VIEWER'].map((role, i) => ({
    user_id: String(i + 1), username: role.toLowerCase(), display_name: `Synthetic ${role}`,
    role, is_active: true, password_hash: credential, auth_version: '0',
  }));
  const queries = [];
  const db = { async query(sql, values) {
    queries.push({ sql, values });
    return { rows: users.filter(user => sql.includes('WHERE username=') ? user.username === values[0] : user.user_id === values[0]).map(row => ({ ...row })) };
  } };
  const auth = createAuth({ db, redis, schema: 'public', config: { allowedOrigins: [origin], idleMs: 1000, absoluteMs: 3000,
    clock: () => time, ...options } });
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/auth', auth.router);
  app.get('/api/admin', auth.authenticate, auth.requireRoles('ADMIN'), (req, res) => res.json({ data: { user_id: req.principal.user_id } }));
  app.post('/api/admin', auth.authenticate, auth.csrf, auth.requireRoles('ADMIN'), (req, res) => res.json({ data: { user_id: req.principal.user_id } }));
  app.use(errorHandler({ error() {} }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const request = async (path, { method = 'GET', body, cookie, headers = {} } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json(), headers: response.headers,
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const login = (role = 'ADMIN', extra = {}) => request('/api/auth/login', { method: 'POST', body: { username: role.toLowerCase(), password: ephemeralPassword }, ...extra });
  return { redis, users, auth, db, queries, request, login, setTime: value => { time = value; } };
}

test('Argon2id hashing uses random salts, verifies passwords, bounds parameters and rejects unsafe new passwords', async () => {
  const another = await hashPassword(ephemeralPassword);
  assert.notEqual(credential, another);
  assert.ok(credential.startsWith('$argon2id$v=19$m=19456,t=2,p=1$'));
  assert.equal(await verifyPassword(ephemeralPassword, credential), true);
  assert.equal(await verifyPassword('a wrong synthetic password', credential), false);
  assert.equal(await verifyPassword(ephemeralPassword, null), false);
  assert.equal(await verifyPassword(ephemeralPassword, credential.replace('m=19456', 'm=999999999')), false);
  assert.equal(await verifyPassword(ephemeralPassword, 'plaintext-is-not-supported'), false);
  assert.throws(() => validateNewPassword('short'), { code: 'INVALID_BODY' });
  assert.throws(() => validateNewPassword('x'.repeat(129)), { code: 'INVALID_BODY' });
});

test('login rotates an opaque HttpOnly session, exposes only identity, and uses parameterized auth SQL', async t => {
  const f = await fixture(t);
  const first = await f.login();
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { data: { user_id: '1', username: 'admin', display_name: 'Synthetic ADMIN', role: 'ADMIN' } });
  assert.match(first.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=3$/u);
  const raw = first.cookie.split('=')[1];
  const sessionKey = `ssw:p3:session:${digest(raw)}`;
  assert.ok(f.redis.data.has(sessionKey));
  const stored = f.redis.get(sessionKey);
  assert.ok(!stored.includes(raw));
  assert.ok(!stored.includes('password_hash'));
  const second = await f.login('ADMIN', { cookie: first.cookie });
  assert.equal(second.status, 200);
  assert.notEqual(first.cookie, second.cookie);
  assert.equal((await f.request('/api/auth/me', { cookie: first.cookie })).status, 401);
  assert.equal((await f.request('/api/auth/me', { cookie: second.cookie })).status, 200);
  assert.ok(f.queries.every(query => query.sql.includes('$1') && !query.sql.includes(ephemeralPassword)));
});

test('unknown, inactive, missing-hash and wrong-password login all return one safe error', async t => {
  const f = await fixture(t);
  const responses = [];
  responses.push(await f.request('/api/auth/login', { method: 'POST', body: { username: 'missing', password: ephemeralPassword } }));
  f.users[0].is_active = false; responses.push(await f.login());
  f.users[0].is_active = true; f.users[0].password_hash = null; responses.push(await f.login());
  f.users[0].password_hash = credential;
  responses.push(await f.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'WrongSyntheticPassword' } }));
  for (const response of responses) {
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' } });
    assert.equal(response.cookie, undefined);
  }
});

test('login requires an explicit allowed Origin and strict username/password fields', async t => {
  const f = await fixture(t);
  assert.equal((await f.login('ADMIN', { headers: { Origin: 'http://untrusted.invalid' } })).status, 403);
  assert.equal((await f.login('ADMIN', { headers: { Origin: '' } })).status, 403);
  assert.equal((await f.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: ephemeralPassword, role: 'ADMIN' } })).status, 400);
  assert.equal((await f.login('ADMIN', { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await f.request('/api/auth/login?user_id=1', { method: 'POST', body: { username: 'admin', password: ephemeralPassword } })).status, 400);
  assert.equal(f.queries.length, 0);
});

test('CSRF is scoped to the session, checks Origin and server-side RBAC rejects every non-admin role', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin')).status, 401);
  const admin = await f.login();
  const csrf = await f.request('/api/auth/csrf', { cookie: admin.cookie });
  assert.equal(csrf.status, 200);
  assert.equal((await f.request('/api/admin', { method: 'POST', cookie: admin.cookie })).status, 403);
  assert.equal((await f.request('/api/admin', { method: 'POST', cookie: admin.cookie, headers: { 'X-CSRF-Token': csrf.body.data.csrf_token, Origin: 'http://untrusted.invalid' } })).status, 403);
  assert.equal((await f.request('/api/admin', { method: 'POST', cookie: admin.cookie, headers: { 'X-CSRF-Token': csrf.body.data.csrf_token } })).status, 200);
  for (const role of ['KEEPER', 'STAFF', 'VIEWER']) {
    const logged = await f.login(role);
    assert.equal(logged.status, 200);
    assert.equal((await f.request('/api/admin', { cookie: logged.cookie, headers: { 'X-Role': 'ADMIN', 'X-User-Id': '1' } })).status, 403);
  }
  const keeper = await f.login('KEEPER');
  const ownCsrf = await f.request('/api/auth/csrf', { cookie: keeper.cookie });
  assert.notEqual(ownCsrf.body.data.csrf_token, csrf.body.data.csrf_token);
});

test('Redis idle timeout and absolute timeout cannot be extended indefinitely', async t => {
  const f = await fixture(t);
  const idle = await f.login();
  f.setTime(101000);
  assert.equal((await f.request('/api/auth/me', { cookie: idle.cookie })).status, 401);
  f.setTime(200000);
  const absolute = await f.login();
  for (const time of [200900, 201800, 202700]) {
    f.setTime(time);
    assert.equal((await f.request('/api/auth/me', { cookie: absolute.cookie })).status, 200);
  }
  f.setTime(203000);
  assert.equal((await f.request('/api/auth/me', { cookie: absolute.cookie })).status, 401);
});

test('DB auth_version and is_active checks invalidate sessions without depending on Redis cleanup', async t => {
  const f = await fixture(t);
  const first = await f.login();
  f.users[0].auth_version = '1';
  assert.equal((await f.request('/api/auth/me', { cookie: first.cookie })).status, 401);
  const second = await f.login();
  f.users[0].is_active = false;
  assert.equal((await f.request('/api/auth/me', { cookie: second.cookie })).status, 401);
});

test('a server clock moving backwards fails closed instead of extending the session lifetime', async t => {
  const f = await fixture(t);
  const logged = await f.login();
  f.setTime(99999);
  assert.equal((await f.request('/api/auth/me', { cookie: logged.cookie })).status, 401);
});

test('Redis per-user invalidation works without scanning keys and does not invalidate other users', async t => {
  const f = await fixture(t);
  const admin = await f.login(), keeper = await f.login('KEEPER');
  await f.auth.revokeUserSessions('1');
  assert.equal((await f.request('/api/auth/me', { cookie: admin.cookie })).status, 401);
  assert.equal((await f.request('/api/auth/me', { cookie: keeper.cookie })).status, 200);
});

test('logout requires CSRF for a valid session, destroys it and safely clears expired sessions', async t => {
  const f = await fixture(t);
  const logged = await f.login();
  const csrf = await f.request('/api/auth/csrf', { cookie: logged.cookie });
  assert.equal((await f.request('/api/auth/logout', { method: 'POST', cookie: logged.cookie })).status, 403);
  const response = await f.request('/api/auth/logout', { method: 'POST', cookie: logged.cookie, headers: { 'X-CSRF-Token': csrf.body.data.csrf_token } });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/u);
  assert.equal((await f.request('/api/auth/me', { cookie: logged.cookie })).status, 401);
  assert.equal((await f.request('/api/auth/logout', { method: 'POST', cookie: logged.cookie })).status, 204);
});

test('Redis failures fail closed and login rate limiting returns 429 with Retry-After', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 5; i++) {
    const response = await f.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'WrongSyntheticPassword' } });
    assert.equal(response.status, 401);
  }
  const limited = await f.login();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '900');
  f.redis.failed = true;
  const failed = await f.login('KEEPER');
  assert.equal(failed.status, 503);
  assert.equal(failed.body.error.code, 'SESSION_STORE_UNAVAILABLE');
});

test('HTTPS cookie flags, duplicate cookie rejection and corrupt sessions do not bypass authentication', async t => {
  const f = await fixture(t, { secureCookies: true });
  const logged = await f.login();
  assert.ok(logged.cookie.startsWith('__Host-warehouse_session='));
  assert.ok(logged.headers.get('set-cookie').endsWith('; Secure'));
  assert.equal((await f.request('/api/auth/me', { cookie: `${logged.cookie}; ${logged.cookie}` })).status, 401);
  f.redis.put(`ssw:p3:session:${digest(logged.cookie.split('=')[1])}`, 'not-json', 1000);
  assert.equal((await f.request('/api/auth/me', { cookie: logged.cookie })).status, 401);
});

test('auth constructors refuse missing origins/Redis and invalid session lifetimes', () => {
  assert.throws(() => createAuth({ db: {}, redis: new MemoryRedis(), config: {} }));
  assert.throws(() => createAuth({ db: {}, redis: new MemoryRedis(), config: { allowedOrigins: ['*'] } }));
  assert.throws(() => createAuth({ db: {}, redis: new MemoryRedis(), config: { allowedOrigins: [origin], cookieName: '__Host-invalid' } }));
  assert.throws(() => createSessionStore(null));
  assert.throws(() => createSessionStore(new MemoryRedis(), { idleMs: 5000, absoluteMs: 1000 }));
});
