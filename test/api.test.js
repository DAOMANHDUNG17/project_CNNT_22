import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createReadOnlyApp as createApp } from '../src/read-app.js';
import { closeResources } from '../src/lifecycle.js';

const logger = { error() {} };

async function serve(t, db, schema = 'public') {
  const server = http.createServer(createApp({ db, schema, logger }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('health executes a database query on every request', async (t) => {
  let queries = 0;
  const base = await serve(t, { async query(sql) {
    assert.equal(sql, 'SELECT 1 AS connected');
    queries++;
    return { rows: [{ connected: 1 }] };
  } });
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { status: 'ok', database: 'connected' });
  }
  assert.equal(queries, 2);
});

test('health returns 503 when PostgreSQL rejects a query without exposing secrets', async (t) => {
  const base = await serve(t, { async query() { throw new Error('secret password SQL'); } });
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'error', database: 'disconnected' });
});

test('products returns the rows supplied by the database and quotes the schema', async (t) => {
  const rows = [{ product_id: 'SP001', product_name: 'Bút chì', base_unit: 'cây', is_active: true, created_at: '2026-11-01T00:00:00.000Z' }];
  const base = await serve(t, { async query(sql, values) {
    assert.match(sql, /FROM "warehouse"\."products" p/);
    assert.match(sql, /LIMIT \$1 OFFSET \$2/);
    assert.deepEqual(values, [20, 0]);
    return { rows: rows.map(row => ({ ...row, _total: '1' })) };
  } }, 'warehouse');
  const response = await fetch(`${base}/api/products`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: rows, count: 1, pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } });
});

test('empty products table returns an empty array', async (t) => {
  const base = await serve(t, { async query() { return { rows: [] }; } });
  const response = await fetch(`${base}/api/products`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: [], count: 0, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
});

for (const [code, status, expected] of [
  ['ECONNREFUSED', 503, 'DATABASE_UNAVAILABLE'],
  ['28P01', 503, 'DATABASE_UNAVAILABLE'],
  ['57014', 503, 'DATABASE_UNAVAILABLE'],
  ['42P01', 500, 'INTERNAL_SERVER_ERROR'],
  ['42501', 500, 'INTERNAL_SERVER_ERROR'],
]) {
  test(`products handles ${code} without exposing SQL or credentials`, async (t) => {
    const base = await serve(t, { async query() {
      throw Object.assign(new Error('password=secret SELECT sensitive'), { code });
    } });
    const response = await fetch(`${base}/api/products`);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, expected);
    assert.doesNotMatch(JSON.stringify(body), /secret|sensitive|SELECT/);
  });
}

test('unknown paths and write methods do not query the database', async (t) => {
  const base = await serve(t, { async query() { assert.fail('Unexpected database access'); } });
  for (const [path, method] of [['/api/missing', 'GET'], ['/api/products', 'POST'], ['/api/health', 'POST']]) {
    const response = await fetch(`${base}${path}`, { method });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  }
});

test('shutdown lets an active request finish before ending the pool', async () => {
  const events = [];
  let releaseQuery;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const gate = new Promise((resolve) => { releaseQuery = resolve; });
  const db = {
    async query() {
      markStarted();
      await gate;
      events.push('query finished');
      return { rows: [] };
    },
    async end() { events.push('pool ended'); },
  };
  const server = http.createServer(createApp({ db, logger }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const request = fetch(`http://127.0.0.1:${server.address().port}/api/products`);
    await started;
    const closing = closeResources(server, db);
    assert.deepEqual(events, []);
    releaseQuery();
    assert.equal((await request).status, 200);
    await closing;
    assert.deepEqual(events, ['query finished', 'pool ended']);
    assert.equal(server.listening, false);
  } finally {
    releaseQuery();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
});

test('shutdown ends the pool if the HTTP server never started', async () => {
  let ended = false;
  await closeResources(http.createServer(), { async end() { ended = true; } });
  assert.equal(ended, true);
});
