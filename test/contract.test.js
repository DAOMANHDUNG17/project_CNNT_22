import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WarehouseApi } from '../docs/api-client.ts';
import { operations, assertSchema, specification } from '../integration/support/openapi.js';

test('all 29 OpenAPI operation IDs have a typed client method and unique method/path', () => {
  assert.equal(operations.length, 29);
  assert.equal(new Set(operations.map(op => `${op.method} ${op.path}`)).size, 29);
  assert.equal(new Set(operations.map(op => op.operationId)).size, 29);
  for (const op of operations) assert.equal(typeof WarehouseApi.prototype[op.operationId], 'function', op.operationId);
});

test('contract checks detect missing fields, secret leakage and bigint precision drift', () => {
  const schema = specification.components.schemas.Identity;
  const identity = { user_id: '1', username: 'sample', display_name: 'Sample', role: 'ADMIN' };
  assertSchema(identity, schema);
  assert.throws(() => assertSchema({ ...identity, password_hash: 'synthetic' }, schema), /unexpected field/);
  assert.throws(() => assertSchema({ ...identity, user_id: 1 }, schema), /string/);
  const { role, ...missing } = identity;
  assert.throws(() => assertSchema(missing, schema), /required/);
  assertSchema({ error: { code: 'TRANSACTION_OUTCOME_UNKNOWN', message: 'Retry same UUID.', transaction_id: randomUUID() } }, specification.components.schemas.Error);
});

test('typed client obtains CSRF once before the first write without forwarding its internal csrf flag', async t => {
  const nativeFetch = globalThis.fetch, requests = [];
  t.after(() => { globalThis.fetch = nativeFetch; });
  const token = 'x'.repeat(43);
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/auth/csrf')) return Response.json({ data: { csrf_token: token } });
    assert.equal(options.headers.get('X-CSRF-Token'), token);
    return Response.json({ data: {} }, { status: 201 });
  };
  const api = new WarehouseApi('/api');
  await api.createProduct({ product_id: 'TEST', product_name: 'Test', base_unit: 'piece' });
  await api.createScanPoint({ scan_point_id: 'TEST', point_name: 'Test' });
  assert.deepEqual(requests.map(r => r.url), ['/api/auth/csrf','/api/products','/api/scan-points']);
  assert.equal(requests[0].options.method, 'GET');
  assert.equal(requests[0].options.body, undefined);
  assert.ok(requests.every(r => r.options.credentials === 'include'));
});
