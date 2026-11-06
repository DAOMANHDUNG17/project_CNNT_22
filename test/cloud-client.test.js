import test from 'node:test';
import assert from 'node:assert/strict';
import { WarehouseApi } from '../docs/api-client.ts';

test('Bearer client sends current token only to same-origin API, omits cookies/CSRF and never retries writes', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const requests = [];
  let token = 'first';
  const api = new WarehouseApi('/api', { getAccessToken: async () => token });
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return Response.json({ data: {} });
  };
  await api.confirmLogin();
  token = 'refreshed';
  await api.recordTransaction({ transaction_id: 'fixed-id', scan_code: 'code', scan_point_id: 'point', movement_type: 'IN', quantity_packages: 1 });
  assert.deepEqual(requests.map(r => r.url), ['/api/auth/login', '/api/transactions']);
  assert.equal(requests[0].body, '{}');
  assert.equal(requests[0].headers.get('authorization'), 'Bearer first');
  assert.equal(requests[1].headers.get('authorization'), 'Bearer refreshed');
  assert.ok(requests.every(r => r.credentials === 'omit' && !r.headers.has('X-CSRF-Token')));
  globalThis.fetch = async () => { requests.push({}); throw new TypeError('synthetic network failure'); };
  await assert.rejects(api.recordTransaction({ transaction_id: 'fixed-id' }));
  assert.equal(requests.length, 3);
  await assert.rejects(api.login('name', 'password'), /provider/);
  await assert.rejects(api.csrf(), /authCapabilities/);
  assert.throws(() => new WarehouseApi('https://untrusted.example/api', { getAccessToken: async () => token }), /same-origin/);
  assert.throws(() => new WarehouseApi('//untrusted.example/api', { getAccessToken: async () => token }), /same-origin/);
  assert.throws(() => new WarehouseApi('/\\untrusted.example/api', { getAccessToken: async () => token }), /same-origin/);
});

test('Bearer missing token makes no HTTP request; logout never retries a rejected mutation', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0, token = null;
  globalThis.fetch = async () => { calls++; return Response.json({}, { status: 401 }); };
  const api = new WarehouseApi('/api', { getAccessToken: async () => token });
  await assert.rejects(api.me(), { status: 401 });
  assert.equal(calls, 0);
  token = 'test';
  await assert.rejects(api.logout(), { status: 401 });
  assert.equal(calls, 1);
});
