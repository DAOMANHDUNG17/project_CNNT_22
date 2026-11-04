import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { WarehouseApi, ApiError } from '../docs/api-client.ts';
import { startSecureServer, testSecret, origin } from './support/secure.js';
import { operations, findOperation, assertSchema, assertResponse } from './support/openapi.js';

test('29 operations through the TypeScript client match OpenAPI on real isolated PostgreSQL and Redis', async t => {
  const ctx = await startSecureServer(t);
  await t.test('all 26 protected operations require a session before accessing resources or writing', async () => {
    const protectedOperations = operations.filter(op => !op.security
      || (op.security.length > 0 && !op.security.some(requirement => Object.keys(requirement).length === 0)));
    assert.equal(protectedOperations.length, 26);
    for (const operation of protectedOperations) {
      const path = operation.path.slice('/api'.length).replace(/\{[^}]+\}/gu, '1');
      const response = await ctx.request(path, { method: operation.method,
        ...(['POST','PATCH'].includes(operation.method) ? { body: {} } : {}) });
      assert.equal(response.status, 401, `${operation.method} ${operation.path}`);
      assertResponse(operation, response.status, response.body);
    }
  });
  const nativeFetch = globalThis.fetch;
  let cookie;
  const evidence = new Map();
  const report = { verifiedAt: new Date().toISOString(), database: ctx.config.database.database,
    source: 'real HTTP + TypeScript client + isolated PostgreSQL/Redis; schema assertions', result: 'FAIL', operations: [] };
  t.after(() => {
    globalThis.fetch = nativeFetch;
    report.operations = [...evidence.values()].sort((a,b) => a.operationId.localeCompare(b.operationId));
    writeFileSync(new URL('../docs/backend-api-verification.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  });
  // Node has no browser cookie jar. This test transport supplies cookie/Origin;
  // production browser code still lets the browser manage both headers.
  globalThis.fetch = async (url, options = {}) => {
    assert.ok(String(url).startsWith(ctx.base + '/'), 'Client must target the isolated test server.');
    const method = options.method ?? 'GET';
    const operation = findOperation(method, new URL(url).pathname);
    assert.ok(operation, `${method}: registered OpenAPI operation`);
    if (options.body !== undefined) assertSchema(JSON.parse(options.body), operation.requestBody.content['application/json'].schema, `${operation.operationId}.request`);
    const headers = new Headers(options.headers);
    headers.set('Origin', origin);
    if (cookie) headers.set('Cookie', cookie);
    const response = await nativeFetch(url, { ...options, headers });
    const newCookie = response.headers.get('set-cookie');
    if (newCookie) cookie = newCookie.split(';')[0];
    const payload = response.status === 204 ? null : await response.clone().json();
    assertResponse(operation, response.status, payload);
    const record = evidence.get(operation.operationId) ?? { operationId: operation.operationId,
      method: operation.method, path: operation.path, statuses: [], success: false };
    if (!record.statuses.includes(response.status)) record.statuses.push(response.status);
    record.success ||= response.ok;
    evidence.set(operation.operationId, record);
    return response;
  };
  const api = new WarehouseApi(ctx.base);
  const suffix = randomBytes(5).toString('hex'), id = `R${suffix}`, point = `R${suffix}`;
  await api.health();
  await assert.rejects(api.me(), e => e instanceof ApiError && e.status === 401);
  await api.login('p3_admin', testSecret('p3_admin-password.txt'));
  await api.me(); await api.csrf();
  await api.createProduct({ product_id: id, product_name: 'Contract product', base_unit: 'piece' });
  await api.updateProduct(id, { product_name: 'Contract updated' });
  await api.setProductStatus(id, true);
  const unit = (await api.addProductUnit(id, { unit_name: 'single', conversion_factor: 1, scan_code: `${id}_I`, is_base_unit: true })).data;
  await api.updateProductUnit(unit.product_unit_id, { unit_name: 'piece' });
  await api.createScanPoint({ scan_point_id: point, point_name: 'Contract gate' });
  await api.updateScanPoint(point, { point_name: 'Contract updated gate' });
  const movement = { transaction_id: randomUUID(), scan_point_id: point, scan_code: unit.scan_code, movement_type: 'IN', quantity_packages: 20 };
  assert.equal((await api.recordTransaction(movement)).meta.result_status, 'CREATED');
  assert.equal((await api.recordTransaction(movement)).meta.result_status, 'DUPLICATE');
  await api.recordTransaction({ ...movement, transaction_id: randomUUID(), movement_type: 'OUT', quantity_packages: 3 });
  assert.equal((await api.getInventory(id)).data.quantity_base, '17');
  await api.listProducts({ q: id }); await api.getProduct(id);
  await api.listInventory({ limit: 3 }); await api.lowStock({ threshold: '18', q: id });
  await api.listTransactions({ productId: id }); await api.getTransaction(movement.transaction_id);
  await api.listScanPoints();
  const user = (await api.createUser({ username: `r${suffix}`, display_name: 'Contract account', role: 'VIEWER', password: randomBytes(24).toString('base64url') })).data;
  await api.listUsers({ q: user.username, role: 'VIEWER', isActive: true });
  await api.updateUser(user.user_id, { display_name: 'Contract updated account' });
  await api.resetUserPassword(user.user_id, randomBytes(24).toString('base64url'));
  await api.setUserStatus(user.user_id, false);
  await api.summary(); await api.stockTrends({ productId: id });
  const top = await api.topProducts({ productId: id, sortBy: 'inQuantity', baseUnit: 'piece' });
  assert.equal(top.data[0].quantity_in_base, '20'); assert.equal(top.data[0].quantity_out_base, '3');
  await assert.rejects(api.updateProductUnit(unit.product_unit_id, { conversion_factor: 2 }), e => e instanceof ApiError && e.status === 409);
  await api.logout();
  await assert.rejects(api.me(), e => e instanceof ApiError && e.status === 401);
  await api.logout(); // stale/absent-session fallback also clears the cookie
  assert.deepEqual([...evidence.keys()].sort(), operations.map(op => op.operationId).sort());
  assert.ok([...evidence.values()].every(op => op.success), 'Every operation must succeed, not merely reject a request.');
  report.result = 'PASS';
});
