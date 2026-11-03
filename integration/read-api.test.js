import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { readConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { createReadOnlyApp as createApp } from '../src/read-app.js';
import { closeResources } from '../src/lifecycle.js';
import { checkPhase2Access } from '../scripts/lib/phase2-access.js';
import { snapshotDatabase } from './support/audit.js';

const json = value => JSON.parse(JSON.stringify(value));
const productFields = ['product_id', 'product_name', 'base_unit', 'is_active', 'created_at'];
const pick = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field]]));

test('phase 2: every read API matches existing PostgreSQL data without any writes', async t => {
  const config = readConfig();
  assert.equal(config.schema, 'public');
  const db = createPool(config.database);
  const server = http.createServer(createApp({ db, schema: config.schema }));
  let before;
  const report = { verifiedAt: new Date().toISOString(), source: 'real PostgreSQL; no fixtures inserted', endpoints: {}, limitations: [] };
  try {
    // Stop before reading new tables unless the application role has exactly the approved access.
    report.access = await checkPhase2Access(db);
    before = await snapshotDatabase(db);
    report.before = before;
    assert.deepEqual(before.protectedFunctions.map(row => row.definition_md5), ['59d25e310aaa5acf12ae7823f154725f']);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const get = async (path, params) => {
      const response = await fetch(`${base}${path}${params ? `?${new URLSearchParams(params)}` : ''}`, { signal: AbortSignal.timeout(10000) });
      return { status: response.status, body: await response.json() };
    };
    const verify = async (endpoint, fn) => {
      await t.test(endpoint, async () => {
        try { await fn(); report.endpoints[endpoint] = { status: 'PASS' }; }
        catch (error) { report.endpoints[endpoint] = { status: 'FAIL', code: error.code || 'ASSERTION_FAILED' }; throw error; }
      });
    };
    const list = async (path, expected, params = {}) => {
      const data = [];
      const pages = Math.max(1, Math.ceil(expected.length / 3));
      for (let page = 1; page <= pages; page++) {
        const result = await get(path, { ...params, page: String(page), limit: '3' });
        assert.equal(result.status, 200);
        assert.equal(result.body.count, result.body.data.length);
        assert.deepEqual(result.body.pagination, { page, limit: 3, total: expected.length, totalPages: Math.ceil(expected.length / 3) });
        assert.deepEqual(result.body.data, json(expected.slice((page - 1) * 3, page * 3)));
        data.push(...result.body.data);
      }
      assert.deepEqual(data, json(expected));
      const past = await get(path, { ...params, page: String(pages + 1), limit: '3' });
      assert.equal(past.status, 200);
      assert.deepEqual(past.body.data, []);
      assert.equal(past.body.pagination.total, expected.length);
      return data;
    };

    // Independent base-table reads + JS assembly check FK joins, rather than reusing API SQL.
    const products = (await db.query('SELECT product_id,product_name,base_unit,is_active,created_at FROM public.products ORDER BY product_id')).rows;
    const units = (await db.query('SELECT product_unit_id,product_id,unit_name,conversion_factor,scan_code,is_base_unit FROM public.product_units ORDER BY product_unit_id')).rows;
    const inventory = (await db.query('SELECT product_id,quantity_base,updated_at FROM public.inventory ORDER BY product_id')).rows;
    const transactions = (await db.query(`SELECT transaction_id,product_id,product_unit_id,scan_point_id,movement_type,
      quantity_packages,conversion_factor_snapshot,quantity_base,inventory_after,created_at
      FROM public.stock_transactions ORDER BY created_at DESC,transaction_id DESC`)).rows;
    const points = (await db.query('SELECT scan_point_id,point_name,is_active FROM public.scan_points ORDER BY scan_point_id')).rows;
    const productMap = new Map(products.map(row => [row.product_id, row]));
    const unitMap = new Map(units.map(row => [`${row.product_unit_id}|${row.product_id}`, row]));
    const pointMap = new Map(points.map(row => [row.scan_point_id, row]));
    const expectedInventory = inventory.map(row => ({ ...pick(productMap.get(row.product_id), ['product_id','product_name','base_unit','is_active']), quantity_base: row.quantity_base, updated_at: row.updated_at }));
    const expectedTransactions = transactions.map(row => ({ transaction_id: row.transaction_id, product_id: row.product_id,
      product_name: productMap.get(row.product_id).product_name, product_unit_id: row.product_unit_id,
      unit_name: unitMap.get(`${row.product_unit_id}|${row.product_id}`).unit_name, scan_point_id: row.scan_point_id,
      point_name: pointMap.get(row.scan_point_id).point_name, movement_type: row.movement_type, quantity_packages: row.quantity_packages,
      conversion_factor_snapshot: row.conversion_factor_snapshot, quantity_base: row.quantity_base, inventory_after: row.inventory_after, created_at: row.created_at }));

    await verify('/api/health', async () => {
      const result = await get('/health');
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { status: 'ok', database: 'connected' });
    });
    await verify('/api/products', async () => {
      await list('/products', products);
      const defaults = await get('/products');
      assert.equal(defaults.status, 200);
      assert.equal(defaults.body.pagination.limit, 20);
      assert.deepEqual(defaults.body.data, json(products.slice(0, 20)));
      for (const q of [products[0]?.product_id, products[0]?.product_name, '%', '_', "' OR 1=1--", '\\']) {
        if (q === undefined) continue;
        // Direct parameterized SQL independently checks PostgreSQL ILIKE/collation and literal wildcard semantics.
        const pattern = `%${q.replace(/[!%_]/gu,'!$&')}%`;
        const direct = (await db.query(`SELECT product_id,product_name,base_unit,is_active,created_at FROM public.products
          WHERE product_id ILIKE $1 ESCAPE '!' OR product_name ILIKE $1 ESCAPE '!' ORDER BY product_id`, [pattern])).rows;
        await list('/products', direct, { q });
      }
    });
    await verify('/api/products/:id', async () => {
      for (const product of products) {
        const result = await get(`/products/${encodeURIComponent(product.product_id)}`);
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, json({ data: { ...pick(product, productFields), units: units.filter(unit => unit.product_id === product.product_id) } }));
      }
    });
    await verify('/api/inventory', async () => { await list('/inventory', expectedInventory); });
    await verify('/api/inventory/:productId', async () => {
      for (const product of products) {
        const result = await get(`/inventory/${encodeURIComponent(product.product_id)}`);
        const expected = expectedInventory.find(row => row.product_id === product.product_id);
        if (expected) { assert.equal(result.status, 200); assert.deepEqual(result.body, json({ data: expected })); }
        else { assert.equal(result.status, 404); assert.equal(result.body.error.code, 'INVENTORY_NOT_FOUND'); }
      }
    });
    await verify('/api/transactions', async () => {
      await list('/transactions', expectedTransactions);
      for (const movementType of ['IN', 'OUT']) {
        await list('/transactions', expectedTransactions.filter(row => row.movement_type === movementType), { movementType });
      }
      for (const product of products) {
        await list('/transactions', expectedTransactions.filter(row => row.product_id === product.product_id), { productId: product.product_id });
      }
      for (const point of points) {
        await list('/transactions', expectedTransactions.filter(row => row.scan_point_id === point.scan_point_id), { scanPointId: point.scan_point_id });
      }
      for (const row of expectedTransactions) {
        const filters = { productId: row.product_id, movementType: row.movement_type, scanPointId: row.scan_point_id };
        await list('/transactions', expectedTransactions.filter(tx => tx.product_id === row.product_id && tx.movement_type === row.movement_type && tx.scan_point_id === row.scan_point_id), filters);
        assert.equal(typeof row.quantity_base, 'string');
        assert.equal(typeof row.inventory_after, 'string');
      }
      await list('/transactions', [], { productId: "' OR 1=1--" });
    });
    await verify('/api/scan-points', async () => { await list('/scan-points', points); });
    report.validationPassed = false;
    await t.test('real HTTP validation, 404, safe errors and no user fields', async () => {
      let missing = '__not_found__';
      while (productMap.has(missing)) missing += '_';
      assert.ok(missing.length <= 20);
      for (const path of [`/products/${missing}`, `/inventory/${missing}`]) {
        const result = await get(path);
        assert.equal(result.status, 404);
        assert.equal(result.body.error.code, 'PRODUCT_NOT_FOUND');
      }
      for (const path of ['/products?limit=101','/inventory?page=0','/transactions?movementType=DROP','/scan-points?limit=1&limit=2']) {
        const result = await get(path);
        assert.equal(result.status, 400);
        assert.equal(result.body.error.code, 'INVALID_QUERY');
      }
      const txResult = await get('/transactions');
      for (const row of txResult.body.data) {
        for (const key of ['user_id','username','display_name','password_hash','role']) assert.ok(!(key in row));
      }
      report.validationPassed = true;
    });

    report.evidence = {
      counts: { products: products.length, product_units: units.length, inventory: inventory.length, stock_transactions: transactions.length, scan_points: points.length },
      productIds: products.map(row => row.product_id),
      inventory: inventory.map(row => ({ product_id: row.product_id, quantity_base: row.quantity_base })),
      movementCounts: { IN: transactions.filter(row => row.movement_type === 'IN').length, OUT: transactions.filter(row => row.movement_type === 'OUT').length },
      transactionIds: transactions.map(row => row.transaction_id),
      transactionSample: transactions[0] ? pick(transactions[0], ['transaction_id','product_id','movement_type','quantity_packages','conversion_factor_snapshot','quantity_base','inventory_after']) : null,
      historicalFactorDifferences: transactions.filter(row => unitMap.get(`${row.product_unit_id}|${row.product_id}`).conversion_factor !== row.conversion_factor_snapshot).length,
    };
    for (const [label, rows] of [['products', products], ['units', units], ['inventory', inventory], ['transactions', transactions], ['scan-points', points]]) {
      if (!rows.length) report.limitations.push(`No existing ${label} rows: only the empty result can be verified against PostgreSQL.`);
    }
    if (!products.some(p => !inventory.some(i => i.product_id === p.product_id))) report.limitations.push('INVENTORY_NOT_FOUND branch has unit coverage; no existing product is missing an inventory row.');
    for (const type of ['IN','OUT']) if (!transactions.some(row => row.movement_type === type)) report.limitations.push(`No existing ${type} transactions: non-empty ${type} filter branch has no real-data coverage.`);
    if (report.evidence.historicalFactorDifferences === 0) report.limitations.push('Existing transaction snapshots equal current unit factors; divergent-factor behavior verified by unit test and stored-column query, without modifying data.');
  } finally {
    try {
      if (before) {
        report.after = await snapshotDatabase(db);
        report.databaseUnchanged = JSON.stringify(report.after) === JSON.stringify(before);
        assert.deepEqual(report.after, before, 'Database data/schema/protected function changed during verification; check concurrent writers.');
      }
    } finally {
      await closeResources(server, db);
      report.result = report.databaseUnchanged === true && report.validationPassed === true && Object.keys(report.endpoints).length === 7
        && Object.values(report.endpoints).every(row => row.status === 'PASS') ? 'PASS' : 'FAIL';
      writeFileSync(new URL('../docs/phase2-verification.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
      console.info('PHASE2_VERIFICATION', JSON.stringify({ result: report.result, evidence: report.evidence, databaseUnchanged: report.databaseUnchanged, limitations: report.limitations }));
    }
  }
});
