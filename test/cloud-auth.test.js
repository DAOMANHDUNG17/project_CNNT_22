import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCloudAuth } from '../src/cloud/auth.js';
import { errorHandler } from '../src/middleware/error-handler.js';

async function fixture(t) {
  let row = { user_id: '9007199254740993', username: 'synthetic', display_name: 'Synthetic', role: 'STAFF', is_active: true, auth_version: '0' };
  let failure, allowed = true;
  const calls = [], logs = [];
  const db = { async query(sql, values) {
    calls.push({ sql, values }); if (failure) throw failure;
    if (sql.includes('rate_cloud_request')) return { rows: [{ allowed, retry_after: 60 }] };
    if (sql.includes('resolve_cloud_principal')) return { rows: row ? [{ ...row }] : [] };
    return { rows: [] };
  } };
  const auth = createCloudAuth({ db, async verifier() { return { subject: '11111111-1111-4111-8111-111111111111', sessionId: '22222222-2222-4222-8222-222222222222' }; },
    allowedOrigins: ['http://127.0.0.1:5173'], rateKey: 'synthetic-hmac-key-'.repeat(3) });
  const app = express(); app.use(express.json()); app.use('/auth', auth.router);
  app.get('/admin', auth.authenticate, auth.requireRoles('ADMIN'), (req, res) => res.json({ data: req.principal.user_id }));
  app.use(errorHandler({ error(value) { logs.push(value); } }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function request(path, { method = 'GET', token = 'a.b.c', origin = 'http://127.0.0.1:5173', body, headers = {} } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: origin,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: response.headers };
  }
  return { auth, calls, logs, request, setRow(value) { row = value; }, row: () => row,
    fail(error) { failure = error; }, limit() { allowed = false; } };
}
test('Cloud auth ignores cookie and client role; maps trusted UUID to exact bigint per request', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/auth/me', { token: null, headers: { Cookie: 'warehouse_session=old', 'X-Role': 'ADMIN' } })).status, 401);
  assert.equal((await f.request('/admin', { headers: { 'X-Role': 'ADMIN', 'X-User-Id': '1' } })).status, 403);
  const me = await f.request('/auth/me'); assert.equal(me.data.data.user_id, '9007199254740993');
  f.setRow({ ...f.row(), role: 'ADMIN' }); assert.equal((await f.request('/admin')).status, 200);
  f.setRow({ ...f.row(), is_active: false }); assert.equal((await f.request('/auth/me')).status, 401);
  f.setRow(null); assert.equal((await f.request('/auth/me')).status, 401);
  assert.ok(f.calls.filter(call => call.sql.includes('resolve_cloud_principal')).every(call => call.values[0] !== '1'));
});
test('Cloud auth exposes capabilities, enforces Origin and revokes the verified session on logout', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/auth/csrf')).data, { data: { mode: 'bearer', csrf_required: false } });
  assert.equal((await f.request('/auth/login', { method: 'POST', body: {} })).status, 200);
  assert.equal((await f.request('/auth/login', { method: 'POST', body: { username: 'fake', password: 'must-not-use' } })).status, 400);
  assert.equal((await f.request('/auth/logout', { method: 'POST', origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await f.request('/auth/logout', { method: 'POST' })).status, 204);
  assert.deepEqual(f.calls.find(call => call.sql.includes('revoke_cloud_session')).values,
    ['22222222-2222-4222-8222-222222222222', '9007199254740993']);
  await assert.rejects(f.auth.hashPassword('must-not-hash'), { status: 503, code: 'CLOUD_ACCOUNT_OPERATION_BLOCKED' });
});
test('Cloud mapping/rate failures fail closed and logs do not expose driver details', async t => {
  const f = await fixture(t); f.limit();
  const limited = await f.request('/auth/me'); assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
  f.fail(new Error('private password and SQL')); assert.equal((await f.request('/auth/me')).status, 503);
  assert.ok(!JSON.stringify(f.logs).includes('private'));
});
