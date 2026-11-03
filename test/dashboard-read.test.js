import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import express from 'express';
import { dashboardReadRouter, dashboardReadQueries } from '../src/routes/dashboard-read.js';
import { createDashboardReadRepository } from '../src/repositories/dashboard-read.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { HttpError } from '../src/http/errors.js';

async function serve(t, options) {
  const app = express();
  app.set('query parser', 'simple');
  app.use('/api', dashboardReadRouter(options));
  app.use(errorHandler({ error() {} }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async path => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`);
    return { status: response.status, body: await response.json() };
  };
}

test('low-stock threshold and literal search remain parameterized, with bigint stock preserved', async t => {
  const row = { product_id: 'P1', product_name: 'Pen', base_unit: 'item', is_active: true,
    quantity_base: '9007199254740993', updated_at: '2026-01-01T00:00:00.000Z' };
  const q = "'_% OR 1=1--";
  const request = await serve(t, { schema: 'odd"schema', db: { async query(sql, values) {
    assert.match(sql, /FROM "odd""schema"\."inventory" i JOIN "odd""schema"\."products"/);
    assert.match(sql, /i.quantity_base < \$1::bigint/);
    assert.ok(!sql.includes(q));
    assert.deepEqual(values, ['9223372036854775807', "%'!_!% OR 1=1--%", 5, 5]);
    return { rows: [{ ...row, _total: '9', password_hash: 'must-not-return' }] };
  } } });
  const result = await request(`/inventory/low-stock?${new URLSearchParams({ threshold: '9223372036854775807', q, page: '2', limit: '5' })}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { data: [row], count: 1, pagination: { page: 2, limit: 5, total: 9, totalPages: 2 } });
});

test('low-stock empty page keeps total and never invents zero stock for missing rows', async t => {
  const request = await serve(t, { db: { async query(sql) {
    assert.match(sql, /FROM "public"\."inventory" i JOIN/);
    assert.ok(!sql.includes('coalesce(i.quantity_base'));
    return { rows: [{ _total: '3', product_id: null }] };
  } } });
  assert.deepEqual((await request('/inventory/low-stock?threshold=10&page=3')).body,
    { data: [], count: 0, pagination: { page: 3, limit: 20, total: 3, totalPages: 1 } });
});

test('transaction detail uses stored history and composite FK without exposing actor or auth fields', async t => {
  const row = { transaction_id: 'e0000000-0000-4000-8000-000000000001', product_id: 'P1', product_name: 'Pen',
    product_unit_id: '9007199254740993', unit_name: 'box', scan_point_id: 'G1', point_name: 'Gate',
    movement_type: 'OUT', quantity_packages: 2, conversion_factor_snapshot: 50,
    quantity_base: '100', inventory_after: '9007199254740993', created_at: '2026-01-01T00:00:00.000Z' };
  const request = await serve(t, { db: { async query(sql, values) {
    assert.match(sql, /u.product_unit_id=t.product_unit_id AND u.product_id=t.product_id/);
    assert.match(sql, /t.conversion_factor_snapshot/);
    assert.match(sql, /t.quantity_base/);
    assert.ok(!sql.includes('u.conversion_factor'));
    assert.ok(!/\b(users|user_id|password_hash|request_scan_code|auth_version)\b/.test(sql));
    assert.deepEqual(values, [row.transaction_id]);
    return { rows: [{ ...row, user_id: '4', password_hash: 'never-return', request_scan_code: 'PRIVATE', auth_version: '2' }] };
  } } });
  assert.deepEqual(await request(`/transactions/${row.transaction_id.toUpperCase()}`), { status: 200, body: { data: row } });
});

test('transaction detail distinguishes not found and invalid UUID before querying', async t => {
  let queries = 0;
  const request = await serve(t, { db: { async query() { queries++; return { rows: [] }; } } });
  assert.equal((await request('/transactions/not-a-uuid')).status, 400);
  assert.equal(queries, 0);
  const result = await request('/transactions/e0000000-0000-4000-8000-000000000001');
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'TRANSACTION_NOT_FOUND');
});

test('users listing fails closed without the admin middleware and never queries DB', async t => {
  const request = await serve(t, { db: { query() { assert.fail('Admin gate was bypassed'); } } });
  const result = await request('/users');
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'FORBIDDEN');
});

test('users listing uses its auth database, exact role/status filter and safe projection', async t => {
  const row = { user_id: '9007199254740993', username: 'staff', display_name: 'Warehouse staff',
    role: 'STAFF', is_active: false, created_at: '2026-01-01T00:00:00.000Z' };
  const request = await serve(t, { requireAdmin(req, res, next) { next(); },
    db: { query() { assert.fail('Users must use userDb'); } }, userDb: { async query(sql, values) {
      assert.ok(!/\b(password_hash|auth_version)\b/.test(sql));
      assert.match(sql, /u.role = \$2 AND u.is_active = \$3/);
      assert.deepEqual(values, ['%staff%', 'STAFF', false, 20, 0]);
      return { rows: [{ ...row, _total: '1', password_hash: 'secret', auth_version: '3' }] };
    } } });
  assert.deepEqual((await request('/users?q=staff&role=STAFF&isActive=false')).body.data, [row]);
});

test('summary returns independent base-unit totals and bigint string KPI counts in one snapshot', async t => {
  const request = await serve(t, { db: { async query(sql, values) {
    assert.match(sql, /GROUP BY p.base_unit/);
    assert.match(sql, /count\(\*\) FILTER \(WHERE i.product_id IS NULL\)/);
    assert.deepEqual(values, ['0']);
    const common = { product_total: '9007199254740993', product_active: '2', product_inactive: '1', missing_inventory: '1',
      transaction_total: '11', in_count: '5', out_count: '6', low_count: '0' };
    return { rows: [{ ...common, base_unit: 'item', quantity_base: '9007199254740993' }, { ...common, base_unit: 'kg', quantity_base: '7' }] };
  } } });
  const result = await request('/dashboard/summary?threshold=0');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, {
    products: { total: '9007199254740993', active: '2', inactive: '1', missing_inventory: '1' },
    inventory_totals: [{ base_unit: 'item', quantity_base: '9007199254740993' }, { base_unit: 'kg', quantity_base: '7' }],
    transactions: { IN: '5', OUT: '6', total: '11' }, low_stock: { threshold: '0', product_count: '0' },
  });
});

test('summary with no inventory returns no invented unit or quantity', async () => {
  const repo = createDashboardReadRepository({ async query() { return { rows: [{ product_total: '0', product_active: '0',
    product_inactive: '0', missing_inventory: '0', transaction_total: '0', in_count: '0', out_count: '0', low_count: '0', base_unit: null }] }; } });
  assert.deepEqual((await repo.summary({ threshold: '10' })).data.inventory_totals, []);
});

test('trends use bounded UTC dates and real zero-count buckets without mixing quantities', async t => {
  const request = await serve(t, { db: { async query(sql, values) {
    assert.match(sql, /generate_series/);
    assert.match(sql, /date_trunc\('month',t.created_at AT TIME ZONE 'UTC'\)/);
    assert.match(sql, /t.created_at < \(\(\$2::date \+ 1\)::timestamp AT TIME ZONE 'UTC'\)/);
    assert.match(sql, /t.product_id = \$3 AND t.movement_type = \$4 AND t.scan_point_id = \$5/);
    assert.ok(!sql.includes('sum(t.quantity_base)'));
    assert.deepEqual(values, ['2026-01-01', '2026-02-28', 'P1', 'OUT', 'G1', 100, 0]);
    return { rows: [{ _total: '2', period_start: new Date('2026-01-01T00:00:00.000Z'), in_count: '0', out_count: '0', total_count: '0' }] };
  } } });
  const result = await request('/dashboard/stock-trends?from=2026-01-01&to=2026-02-28&granularity=month&productId=P1&movementType=OUT&scanPointId=G1&limit=100');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data[0], { period_start: '2026-01-01T00:00:00.000Z', in_count: '0', out_count: '0', total_count: '0' });
});

test('top product quantity ranking requires a base-unit filter and orders by numeric rank', async t => {
  let queries = 0;
  const request = await serve(t, { db: { async query(sql, values) {
    queries++;
    assert.match(sql, /coalesce\(sum\(t.quantity_base\) FILTER \(WHERE t.movement_type='OUT'\),0\) AS _rank/);
    assert.match(sql, /ORDER BY _rank DESC, product_id ASC/);
    assert.match(sql, /p.base_unit=\$3/);
    assert.deepEqual(values, ['2026-01-01', '2026-01-31', 'item', 20, 0]);
    return { rows: [{ _total: '1', product_id: 'P1', product_name: 'Pen', base_unit: 'item', transaction_count: '20',
      in_count: '8', out_count: '12', quantity_in_base: '9007199254740993', quantity_out_base: '9007199254740994', _rank: '9007199254740994' }] };
  } } });
  assert.equal((await request('/dashboard/top-products?sortBy=outQuantity')).status, 400);
  assert.equal(queries, 0);
  const result = await request('/dashboard/top-products?from=2026-01-01&to=2026-01-31&sortBy=outQuantity&baseUnit=item');
  assert.equal(result.status, 200);
  assert.equal(result.body.data[0].quantity_out_base, '9007199254740994');
  assert.ok(!('_rank' in result.body.data[0]));
});

test('dashboard queries reject malformed/repeated/unknown parameters without reaching DB', async t => {
  const request = await serve(t, { requireAdmin(req, res, next) { next(); }, db: { query() { assert.fail('Invalid request reached DB'); } } });
  for (const path of [
    '/inventory/low-stock?threshold=-1', '/inventory/low-stock?threshold=01', '/inventory/low-stock?threshold=9223372036854775808',
    '/inventory/low-stock?threshold=1&threshold=2', '/inventory/low-stock?threshold=1e2', '/inventory/low-stock?limit=101',
    '/dashboard/summary?threshold=1.2', '/dashboard/summary?sort=anything', '/users?role=admin', '/users?isActive=1',
    '/users?q=a&q=b', '/dashboard/stock-trends?from=2026-02-30&to=2026-03-01',
    '/dashboard/stock-trends?from=2026-02-01&to=2026-01-01', '/dashboard/stock-trends?from=2020-01-01&to=2026-01-01',
    '/dashboard/stock-trends?from=2026-01-01T00:00:00Z', '/dashboard/stock-trends?granularity=hour',
    '/dashboard/stock-trends?from=0000-01-01&to=0000-01-02', '/dashboard/stock-trends?to=0001-01-01',
    '/dashboard/top-products?sortBy=quantity', '/dashboard/top-products?sortBy=inQuantity&baseUnit=',
    '/dashboard/top-products?movementType=out', '/dashboard/top-products?sortBy=transactions&unknown=1',
    '/transactions/e0000000-0000-4000-8000-000000000001?role=ADMIN',
  ]) assert.equal((await request(path)).status, 400, path);
});

test('query ranges permit a leap-year window of exactly 366 days and reject an extra day', () => {
  const valid = dashboardReadQueries.trends({ from: '2024-01-01', to: '2024-12-31' });
  assert.equal(valid.from, '2024-01-01');
  assert.equal(valid.to, '2024-12-31');
  assert.throws(() => dashboardReadQueries.trends({ from: '2024-01-01', to: '2025-01-01' }), HttpError);
});
