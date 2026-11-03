import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createAdminWriteRepository } from '../src/repositories/admin-write.js';
import { adminWriteRouter } from '../src/routes/admin-write.js';
import { errorHandler } from '../src/middleware/error-handler.js';

const admin = { user_id: '9007199254740993', role: 'ADMIN', is_active: true };
async function http(t, options = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.principal = options.principal === undefined ? admin : options.principal; next(); });
  app.use('/api', adminWriteRouter(options));
  app.get('/api/products', (req, res) => res.json({ data: [] }));
  app.use(errorHandler({ error() {} }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (path, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
}

test('admin repository parameterizes actor/action/payload and whitelists safe result fields', async () => {
  const repository = createAdminWriteRepository({ async query(sql, values) {
    assert.equal(sql, 'SELECT "public".admin_dashboard_write($1::bigint,$2::text,$3::jsonb) AS data');
    assert.deepEqual(values, [admin.user_id, 'user.create', JSON.stringify({ username: "x' OR 1=1--" })]);
    return { rows: [{ data: { user_id: '9007199254740994', username: 'x', display_name: 'User',
      role: 'STAFF', is_active: true, created_at: '2026-11-04T12:00:00+00:00', password_hash: 'must-not-return', auth_version: '7' } }] };
  } });
  const result = await repository.execute(admin.user_id, 'user.create', { username: "x' OR 1=1--" });
  assert.equal(result.data.user_id, '9007199254740994');
  assert.equal(result.data.created_at, '2026-11-04T12:00:00.000Z');
  assert.ok(!Object.hasOwn(result.data, 'password_hash'));
  assert.ok(!Object.hasOwn(result.data, 'auth_version'));
});

test('admin repository maps safe domain failures but preserves unexpected database errors', async () => {
  for (const [code, status, apiCode] of [['PZA05', 409, 'LAST_ADMIN_REQUIRED'], ['PZA06', 409, 'UNSAFE_UNIT_CHANGE'],
    ['PZA04', 403, 'FORBIDDEN'], ['PZA03', 409, 'RESOURCE_CONFLICT'], ['PZA02', 404, 'RESOURCE_NOT_FOUND']]) {
    const repository = createAdminWriteRepository({ async query() { throw Object.assign(new Error('private sql detail'), { code }); } });
    await assert.rejects(repository.execute('1', 'product.update', {}), error => error.status === status && error.code === apiCode && !error.message.includes('private'));
  }
  const denied = Object.assign(new Error('denied'), { code: '42501' });
  await assert.rejects(createAdminWriteRepository({ async query() { throw denied; } }).execute('1', 'product.update', {}), error => error === denied);
});

test('admin write guards deny unauthenticated, inactive and non-admin requests before hashing or SQL', async t => {
  for (const principal of [null, { ...admin, is_active: false }, { ...admin, role: 'KEEPER' }, { ...admin, role: 'STAFF' }, { ...admin, role: 'VIEWER' }]) {
    let touched = false;
    const request = await http(t, { principal, repository: { async execute() { touched = true; } },
      async hashPassword() { touched = true; } });
    const result = await request('/users', { username: 'a', display_name: 'A', role: 'ADMIN', password: 'synthetic-password' });
    assert.equal(result.status, principal ? 403 : 401);
    assert.equal(touched, false);
  }
});

test('admin create hashes only validated plaintext and uses the authenticated actor ID', async t => {
  let calls = 0;
  const request = await http(t, { async hashPassword(value) { assert.equal(value, 'synthetic-password'); return 'synthetic-phc'; },
    repository: { async execute(actor, action, payload) {
      calls++;
      assert.equal(actor, admin.user_id);
      assert.equal(action, 'user.create');
      assert.equal(payload.password_hash, 'synthetic-phc');
      assert.ok(!Object.hasOwn(payload, 'password'));
      return { data: { user_id: '7', username: payload.username, role: payload.role } };
    } } });
  const created = await request('/users', { username: 'new-user', display_name: 'New User', role: 'STAFF', password: 'synthetic-password' });
  assert.equal(created.status, 201);
  assert.ok(!JSON.stringify(created.body).includes('synthetic-password'));
  const forged = await request('/users', { username: 'new-user', display_name: 'New User', role: 'STAFF', password: 'synthetic-password', user_id: '1' });
  assert.equal(forged.status, 400);
  assert.equal(calls, 1);
});

test('admin PATCH rejects empty bodies, identifiers, client hashes and mutable scan bindings', async t => {
  let calls = 0;
  const request = await http(t, { repository: { async execute() { calls++; return { data: {} }; } } });
  for (const [path, payload] of [['/products/P1', {}], ['/products/P1', { product_id: 'P2' }],
    ['/product-units/01', { unit_name: 'box' }], ['/product-units/1', { scan_code: 'NEW' }],
    ['/users/1', { password_hash: 'must-not-accept' }], ['/scan-points/A', { is_active: 'false' }],
    ['/products/P1/units', { unit_name: 'box', conversion_factor: 1.1, scan_code: 'CODE' }]]) {
    const response = await request(path, payload, path.endsWith('/units') ? 'POST' : 'PATCH');
    assert.equal(response.status, 400, path);
  }
  assert.equal(calls, 0);
});

test('committed user update remains successful if Redis cleanup fails; SQL counter provides invalidation', async t => {
  const request = await http(t, { repository: { async execute(actor, action, payload) {
    assert.equal(action, 'user.status');
    assert.equal(payload.user_id, '2');
    return { data: { user_id: '2', is_active: false } };
  } }, async revokeUserSessions(id) { assert.equal(id, '2'); throw new Error('Redis unavailable'); } });
  assert.equal((await request('/users/2/status', { is_active: false }, 'PATCH')).status, 200);
});

test('write router does not intercept read routes for STAFF', async t => {
  const request = await http(t, { principal: { ...admin, role: 'STAFF' }, repository: {} });
  assert.equal((await request('/products', undefined, 'GET')).status, 200);
});
