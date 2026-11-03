import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { createReadOnlyApp as createApp } from '../src/read-app.js';
import { createPool } from '../src/db/pool.js';

const product = { product_id: 'SP001', product_name: 'Bút chì', base_unit: 'cây', is_active: true, created_at: '2026-11-01T00:00:00.000Z' };
async function serve(t, query, schema = 'public') {
  const server = http.createServer(createApp({ db: { query }, schema, logger: { error() {} } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return async (path, options) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, options);
    return { status: response.status, body: await response.json() };
  };
}

test('product search escapes literal wildcard/backslash and passes values as parameters', async t => {
  const q = "a%_!\\' OR 1=1--";
  const request = await serve(t, async (sql, values) => {
    assert.match(sql, /p.product_id ILIKE \$1 ESCAPE '!'/);
    assert.match(sql, /p.product_name ILIKE \$1 ESCAPE '!'/);
    assert.ok(!sql.includes(q));
    assert.deepEqual(values, ["%a!%!_!!\\' OR 1=1--%", 7, 7]);
    return { rows: [{ ...product, _total: '30' }] };
  });
  const result = await request(`/products?${new URLSearchParams({ q, page: '2', limit: '7' })}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.pagination, { page: 2, limit: 7, total: 30, totalPages: 5 });
});

test('empty page retains the actual total count and maximum page size is supported', async t => {
  const request = await serve(t, async (sql, values) => {
    assert.deepEqual(values, [100, 100]);
    return { rows: [{ _total: '45', product_id: null }] };
  });
  const result = await request('/products?page=2&limit=100');
  assert.deepEqual(result.body, { data: [], count: 0, pagination: { page: 2, limit: 100, total: 45, totalPages: 1 } });
});

test('product detail parameterizes path ID, returns units and preserves bigint identifiers', async t => {
  const id = "x' OR 1=1--";
  const request = await serve(t, async (sql, values) => {
    assert.match(sql, /LEFT JOIN "public"\."product_units" u ON u.product_id = p.product_id/);
    assert.match(sql, /WHERE p.product_id = \$1/);
    assert.ok(!sql.includes(id));
    assert.deepEqual(values, [id]);
    return { rows: [{ ...product, _unit_product_unit_id: '9007199254740993', _unit_product_id: 'SP001',
      _unit_unit_name: 'hộp', _unit_conversion_factor: 10, _unit_scan_code: 'BOX-01', _unit_is_base_unit: false,
      password_hash: 'must-not-return' }] };
  });
  const result = await request(`/products/${encodeURIComponent(id)}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.units, [{ product_unit_id: '9007199254740993', product_id: 'SP001', unit_name: 'hộp', conversion_factor: 10, scan_code: 'BOX-01', is_base_unit: false }]);
  assert.ok(!JSON.stringify(result.body).includes('must-not-return'));
});

test('product with no unit rows returns units=[] without inventing a unit', async t => {
  const request = await serve(t, async () => ({ rows: [{ ...product, _unit_product_unit_id: null }] }));
  assert.deepEqual((await request('/products/SP001')).body.data.units, []);
});

for (const path of ['/products/missing', '/inventory/missing']) {
  test(`${path} returns PRODUCT_NOT_FOUND`, async t => {
    const request = await serve(t, async () => ({ rows: [] }));
    const result = await request(path);
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'PRODUCT_NOT_FOUND');
  });
}

test('inventory missing for an existing product returns a distinct 404 rather than zero', async t => {
  const request = await serve(t, async () => ({ rows: [{ ...product, _inventory_product_id: null, quantity_base: null }] }));
  const result = await request('/inventory/SP001');
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'INVENTORY_NOT_FOUND');
});

test('inventory list and detail use the FK and preserve bigint stock', async t => {
  const request = await serve(t, async (sql, values) => {
    assert.match(sql, /ON [pi].product_id = [ip].product_id/);
    const row = { ...product, quantity_base: '9007199254740993', updated_at: '2026-11-01T00:00:00.000Z', _inventory_product_id: 'SP001', _total: '1' };
    if (values.length === 1) assert.deepEqual(values, ['SP001']);
    return { rows: [row] };
  });
  const list = await request('/inventory');
  const detail = await request('/inventory/SP001');
  assert.equal(list.status, 200);
  assert.equal(detail.status, 200);
  assert.deepEqual(list.body.data[0], detail.body.data);
  assert.equal(detail.body.data.quantity_base, '9007199254740993');
});

test('transactions use the composite FK, stored snapshot/quantity, AND filters and no users data', async t => {
  const row = { transaction_id: '11111111-1111-4111-8111-111111111111', product_id: 'SP001', product_name: 'Bút chì',
    product_unit_id: '9007199254740993', unit_name: 'hộp', scan_point_id: 'SP-IN', point_name: 'Cổng nhập',
    movement_type: 'IN', quantity_packages: 2147483647, conversion_factor_snapshot: 2147483647,
    quantity_base: '4611686014132420609', inventory_after: '4611686014132420609', created_at: '2026-11-01T00:00:00.000Z' };
  const request = await serve(t, async (sql, values) => {
    assert.match(sql, /u.product_unit_id = t.product_unit_id AND u.product_id = t.product_id/);
    assert.match(sql, /s.scan_point_id = t.scan_point_id/);
    assert.match(sql, /t.product_id = \$1 AND t.movement_type = \$2 AND t.scan_point_id = \$3/);
    assert.match(sql, /t.conversion_factor_snapshot/);
    assert.match(sql, /t.quantity_base/);
    assert.ok(!sql.includes('u.conversion_factor'));
    assert.ok(!/\b(users|user_id|password_hash)\b/u.test(sql));
    assert.deepEqual(values, ['SP001', 'IN', 'SP-IN', 5, 0]);
    return { rows: [{ ...row, _total: '1', user_id: '42', password_hash: 'secret', conversion_factor: 2 }] };
  });
  const result = await request('/transactions?productId=SP001&movementType=IN&scanPointId=SP-IN&limit=5');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, [row]);
});

test('scan-points includes inactive rows and whitelists response fields', async t => {
  const point = { scan_point_id: 'P1', point_name: 'Cổng', is_active: false };
  const request = await serve(t, async sql => {
    assert.match(sql, /FROM "public"\."scan_points" s/);
    return { rows: [{ ...point, _total: '1', user_id: '123', password_hash: 'secret' }] };
  });
  assert.deepEqual((await request('/scan-points')).body.data, [point]);
});

for (const path of ['/products', '/inventory', '/transactions', '/scan-points']) {
  test(`${path} rejects invalid/repeated/unknown pagination without querying DB`, async t => {
    const request = await serve(t, async () => assert.fail('Invalid request reached DB'));
    for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=9007199254740992', 'page=9007199254740991&limit=100',
      'limit=0', 'limit=101', 'limit=1e2', 'page=1&page=2', 'page[x]=1', 'sort=product_id']) {
      assert.equal((await request(`${path}?${query}`)).status, 400, query);
    }
  });
}

test('filter/path validation rejects empty, oversized, malformed and unsupported inputs', async t => {
  const request = await serve(t, async () => assert.fail('Invalid request reached DB'));
  for (const path of ['/products?q=', `/products?q=${'a'.repeat(151)}`, '/products?q=a&q=b', '/products?q=%00',
    '/transactions?movementType=in', '/transactions?movementType=DELETE', '/transactions?productId=',
    `/transactions?scanPointId=${'x'.repeat(21)}`, `/products/${'a'.repeat(21)}`, '/products/%20',
    '/products/%FF', '/products/SP001?page=1', '/inventory/SP001?q=hello']) {
    assert.equal((await request(path)).status, 400, path);
  }
});

test('new routes never accept write methods', async t => {
  const request = await serve(t, async () => assert.fail('Write request reached DB'));
  for (const path of ['/products/SP001', '/inventory', '/inventory/SP001', '/transactions', '/scan-points']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await request(path, { method })).status, 404);
  }
});

test('schema identifier is escaped independently of request values', async t => {
  const request = await serve(t, async sql => {
    assert.match(sql, /FROM "odd""schema"\."products"/);
    return { rows: [] };
  }, 'odd"schema');
  assert.equal((await request('/products')).status, 200);
});

test('unsafe pagination totals fail safely', async t => {
  const request = await serve(t, async () => ({ rows: [{ _total: '9007199254740992', product_id: null }] }));
  const result = await request('/products');
  assert.equal(result.status, 500);
  assert.equal(result.body.error.code, 'INTERNAL_SERVER_ERROR');
});

test('idle pool errors are handled without exposing connection details', async () => {
  const logged = [];
  const pool = createPool({ max: 1 }, { error: value => logged.push(value) });
  try {
    pool.emit('error', Object.assign(new Error('password=do-not-log'), { code: 'ECONNRESET' }));
    assert.deepEqual(logged, [{ event: 'database_idle_error', code: 'ECONNRESET', type: 'Error' }]);
  } finally { await pool.end(); }
});
