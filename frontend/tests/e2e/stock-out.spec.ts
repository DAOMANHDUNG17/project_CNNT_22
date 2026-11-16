import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parsePendingStockOut } from '../../src/lib/pendingStockOut';

const envFile = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(envFile)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

async function setup(page: import('@playwright/test').Page, role: 'ADMIN' | 'STAFF' | 'VIEWER' = 'STAFF', initialStock = '48') {
  test.skip(!storageKey, 'Supabase URL is needed for the isolated browser session');
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({ access_token: 'out-e2e-token', refresh_token: 'out-e2e-refresh', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', email: 'staff@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
  }, { key: storageKey! });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user_id: '42', username: 'staff', display_name: 'Staff', role } }));
  await page.route('**/api/products', route => route.fulfill({ json: { data: [{ product_id: 'SP013', product_name: 'Bút mực', base_unit: 'chiếc', is_active: true }], count: 1 } }));
  await page.route('**/api/product-units', route => route.fulfill({ json: { data: [{ product_unit_id: '29', product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', conversion_factor: 24, scan_code: 'BOX-ABC', is_base_unit: false }], count: 1 } }));
  let stock = initialStock;
  let inventoryReads = 0;
  await page.route('**/api/inventory', route => { inventoryReads++; return route.fulfill({ json: { data: [{ product_id: 'SP013', product_name: 'Bút mực', base_unit: 'chiếc', is_active: true, quantity_base: stock }], count: 1 } }); });
  await page.route('**/api/scan-points/my', route => route.fulfill({ json: { data: [{ scan_point_id: 'SCAN-01', point_name: 'Cửa A', is_active: true }], count: 1 } }));
  return { setStock: (value: string) => { stock = value; }, inventoryReads: () => inventoryReads };
}

async function selectOut(page: import('@playwright/test').Page) {
  await page.goto('/stock-movement');
  await page.getByRole('tab', { name: 'Xuất kho' }).click();
  const select = page.getByRole('combobox', { name: 'Điểm quét xuất kho', exact: true });
  if (await select.count()) { await select.click(); await page.getByTitle('SCAN-01 — Cửa A', { exact: true }).click(); }
  else await expect(page.getByRole('textbox', { name: 'Điểm quét được phân công' })).toHaveValue(/SCAN-01/);
  await expect(page.getByText('SCAN-OFF — Cửa B')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Mã quét xuất kho' }).fill('BOX-ABC');
}

test('OUT preview requires confirmation, sends exact body once, refreshes inventory and creates a new UUID next time', async ({ page }) => {
  const db = await setup(page);
  const bodies: Array<Record<string, string>> = [];
  await page.route('**/api/stock-movements', async route => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe('Bearer out-e2e-token');
    const body = route.request().postDataJSON() as Record<string, string>;
    bodies.push(body);
    db.setStock(bodies.length === 1 ? '24' : '0');
    await route.fulfill({ status: 201, json: { data: { ...body, product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', quantity_packages: 1, conversion_factor_snapshot: 24, quantity_base: '24', inventory_before: bodies.length === 1 ? '48' : '24', inventory_after: bodies.length === 1 ? '24' : '0' } } });
  });
  await selectOut(page);
  await page.getByRole('textbox', { name: 'Mã quét xuất kho' }).press('Enter');
  await expect(page.getByText('1 Hộp = 24 chiếc')).toBeVisible();
  await expect(page.getByText('48 chiếc')).toBeVisible();
  expect(bodies).toHaveLength(0);
  await page.getByRole('button', { name: 'Xác nhận xuất kho' }).dblclick();
  await expect(page.getByText('Đã xuất kho', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(Object.keys(bodies[0]!).sort()).toEqual(['movement_type', 'quantity_packages', 'scan_code', 'scan_point_id', 'transaction_id']);
  expect(bodies[0]).toMatchObject({ scan_code: 'BOX-ABC', scan_point_id: 'SCAN-01', movement_type: 'OUT', quantity_packages: 1 });
  expect(bodies[0]!.transaction_id).toMatch(/^[0-9a-f-]{36}$/);
  await expect.poll(() => db.inventoryReads()).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('24 chiếc').first()).toBeVisible();
  await page.getByRole('button', { name: 'Lượt xuất tiếp theo' }).click();
  await page.getByRole('textbox', { name: 'Mã quét xuất kho' }).fill('BOX-ABC');
  await page.getByRole('button', { name: 'Xác nhận xuất kho' }).click();
  await expect(page.getByText('Đã xuất kho', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]!.transaction_id).not.toBe(bodies[0]!.transaction_id);
});

test('editable OUT count previews exact depletion and submits two packages', async ({ page }) => {
  await setup(page);
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/stock-movements', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    return route.fulfill({ status: 201, json: { data: { ...body, product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', quantity_base: '48', inventory_before: '48', inventory_after: '0' } } });
  });
  await selectOut(page);
  await page.getByRole('spinbutton', { name: 'Số đơn vị đóng gói xuất' }).fill('2');
  await expect(page.getByText('0 chiếc')).toBeVisible();
  expect(bodies).toHaveLength(0);
  await page.getByRole('button', { name: 'Xác nhận xuất kho' }).click();
  await expect(page.getByText('Đã xuất kho', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ movement_type: 'OUT', quantity_packages: 2 });
});

test('insufficient preview blocks new OUT and never sends POST', async ({ page }) => {
  await setup(page, 'ADMIN', '48');
  let calls = 0;
  await page.route('**/api/stock-movements', route => { calls++; return route.abort(); });
  await selectOut(page);
  await page.getByRole('spinbutton', { name: 'Số đơn vị đóng gói xuất' }).fill('3');
  await expect(page.getByText('Không đủ tồn kho để xuất.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Xác nhận xuất kho' })).toBeDisabled();
  expect(calls).toBe(0);
});

test('ambiguous OUT retains UUID and payload across reload, independent of IN pending', async ({ page }) => {
  await setup(page, 'ADMIN');
  const bodies: Array<Record<string, string>> = [];
  await page.route('**/api/stock-movements', async route => {
    const body = route.request().postDataJSON() as Record<string, string>;
    bodies.push(body);
    if (bodies.length === 1) { await route.abort('timedout'); return; }
    await route.fulfill({ status: 200, json: { data: { ...body, product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', quantity_base: '48', inventory_before: '48', inventory_after: '0' } } });
  });
  await selectOut(page);
  await page.getByRole('spinbutton', { name: 'Số đơn vị đóng gói xuất' }).fill('2');
  await page.getByRole('button', { name: 'Xác nhận xuất kho' }).click();
  await expect(page.getByText('Lượt xuất đang được giữ để thử lại')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mã quét xuất kho' })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('warehouse:pending-stock-out:42'))).not.toBeNull();
  await page.reload();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('warehouse:pending-stock-out:42'))).not.toBeNull();
  const stored = await page.evaluate(() => sessionStorage.getItem('warehouse:pending-stock-out:42'));
  expect(parsePendingStockOut(stored), stored ?? 'missing').not.toBeNull();
  await page.getByRole('tab', { name: 'Xuất kho' }).click();
  await expect(page.getByRole('button', { name: 'Thử lại lượt xuất' })).toBeVisible();
  await page.getByRole('tab', { name: 'Nhập kho' }).click();
  await expect(page.getByText('Lượt nhập đang được giữ để thử lại')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Xuất kho' }).click();
  await page.getByRole('button', { name: 'Thử lại lượt xuất' }).click();
  await expect(page.getByText('Đã xuất kho', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]?.quantity_packages).toBe(2);
});

test('backend 409 shows the exact shortage and preserves OUT retry/discard choice', async ({ page }) => {
  await setup(page);
  await page.route('**/api/stock-movements', route => route.fulfill({ status: 409, json: { message: 'Không đủ tồn kho để xuất.' } }));
  await selectOut(page);
  await page.getByRole('button', { name: 'Xác nhận xuất kho' }).click();
  await expect(page.getByText('Không đủ tồn kho để xuất.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Thử lại lượt xuất' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bỏ lượt bị từ chối' })).toBeVisible();
  await expect(page.getByText('Đã xuất kho', { exact: true })).toHaveCount(0);
});

test('VIEWER cannot confirm OUT', async ({ page }) => {
  await setup(page, 'VIEWER');
  await page.goto('/stock-movement');
  await expect(page.getByRole('tab', { name: 'Xuất kho' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xác nhận xuất kho' })).toHaveCount(0);
});

test('transaction history renders a recorded OUT with exact negative quantity', async ({ page }) => {
  await setup(page);
  const id = '550e8400-e29b-41d4-a716-446655440000';
  await page.route('**/api/transactions**', route => route.fulfill({ json: {
    data: [{ transaction_id: id, product_id: 'SP013', product_name: 'Bút mực', product_unit_id: '29', unit_name: 'Hộp', scan_point_id: 'SCAN-01', point_name: 'Cửa A', user_id: '42', display_name: 'Staff', movement_type: 'OUT', quantity_packages: 1, conversion_factor_snapshot: 24, quantity_base: '24', inventory_before: '48', inventory_after: '24', scan_code_snapshot: 'BOX-ABC', created_at: '2026-11-15T00:00:00Z' }],
    count: 1, pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  } }));
  await page.goto('/transactions');
  await expect(page.getByRole('row').filter({ hasText: 'Bút mực' })).toContainText('Xuất kho');
  await expect(page.getByRole('row').filter({ hasText: 'Bút mực' })).toContainText('-24');
  await expect(page.getByRole('button', { name: `Copy UUID ${id}` })).toBeVisible();
});
