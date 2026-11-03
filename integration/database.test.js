import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import pg from 'pg';
import { readConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { createReadOnlyApp as createApp } from '../src/read-app.js';
import { closeResources } from '../src/lifecycle.js';

test('real PostgreSQL: role, health and products match a direct read-only query', async () => {
  const config = readConfig();
  const db = createPool(config.database);
  const server = http.createServer(createApp({ db, schema: config.schema }));
  try {
    const identity = await db.query(`SELECT current_database() AS database,
      current_setting('transaction_read_only') AS read_only,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`);
    assert.equal(identity.rows[0].database, config.database.database);
    assert.equal(identity.rows[0].is_superuser, false);
    assert.equal(identity.rows[0].read_only, 'on');
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', database: 'connected' });
    const all = [];
    let totalPages = 1;
    let total = 0;
    for (let page = 1; page <= Math.max(1, totalPages); page++) {
      const products = await fetch(`${base}/api/products?page=${page}&limit=3`);
      assert.equal(products.status, 200);
      const body = await products.json();
      assert.equal(body.count, body.data.length);
      assert.equal(body.pagination.page, page);
      total = body.pagination.total;
      totalPages = body.pagination.totalPages;
      all.push(...body.data);
    }
    const direct = await db.query(`SELECT * FROM ${pg.escapeIdentifier(config.schema)}."products" ORDER BY product_id`);
    const canonical = (rows) => rows.map((row) => JSON.stringify(row)).sort();
    // Normalize Date/JSON serialization exactly as the HTTP response does.
    assert.deepEqual(canonical(all), canonical(JSON.parse(JSON.stringify(direct.rows))));
    assert.equal(total, direct.rows.length);
    console.info(`Verified ${all.length} product rows across pages against PostgreSQL (no rows written).`);
  } finally {
    await closeResources(server, db);
  }
});
