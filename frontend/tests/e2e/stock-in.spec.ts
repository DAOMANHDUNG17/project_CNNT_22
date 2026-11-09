import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const envFile = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(envFile)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

async function setup(page: import('@playwright/test').Page, role: 'ADMIN' | 'STAFF' | 'VIEWER' = 'STAFF') {
  test.skip(!storageKey, 'Supabase URL is needed for the local test session');
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'local-e2e-access-token', refresh_token: 'local-e2e-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
        email: 'staff@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' },
    }));
  }, { key: storageKey! });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user_id: '42', username: 'staff', display_name: 'Staff', role } }));
  await page.route('**/api/products', route => route.fulfill({ json: { data: [{ product_id: 'SP013', product_name: 'Bút mực', base_unit: 'chiếc', is_active: true }], count: 1 } }));
  await page.route('**/api/product-units', route => route.fulfill({ json: { data: [{ product_unit_id: '29', product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', conversion_factor: 24, scan_code: 'BOX-ABC', is_base_unit: false }], count: 1 } }));
  let inventory = '100';
  let inventoryReads = 0;
  await page.route('**/api/inventory', route => { inventoryReads++; return route.fulfill({ json: { data: [{ product_id: 'SP013', product_name: 'Bút mực', base_unit: 'chiếc', is_active: true, quantity_base: inventory }], count: 1 } }); });
  await page.route('**/api/scan-points', route => route.fulfill({ json: { data: [
    { scan_point_id: 'SCAN-01', point_name: 'Cửa A', is_active: true },
    { scan_point_id: 'SCAN-02', point_name: 'Cửa B', is_active: false },
  ], count: 2 } }));
  return { setInventory: (value: string) => { inventory = value; }, inventoryReads: () => inventoryReads };
}

test('scan preview needs explicit confirmation, then bearer POST refreshes real inventory', async ({ page }) => {
  const db = await setup(page);
  let calls = 0;
  await page.route('**/api/stock-movements', async route => {
    calls++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe('Bearer local-e2e-access-token');
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ scan_code: 'BOX-ABC', scan_point_id: 'SCAN-01', movement_type: 'IN' });
    expect(body.transaction_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(body).sort()).toEqual(['movement_type', 'scan_code', 'scan_point_id', 'transaction_id']);
    db.setInventory('124');
    await route.fulfill({ status: 201, json: { data: { ...body, product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', quantity_base: '24', inventory_before: '100', inventory_after: '124' } } });
  });
  await page.goto('/stock-movement');
  await expect(page.getByText('Quét hoặc nhập mã')).toBeVisible();
  await page.locator('.ant-select').click();
  await expect(page.getByText('SCAN-02 — Cửa B')).toHaveCount(0);
  await page.getByText('SCAN-01 — Cửa A').last().click();
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('BOX-ABC');
  await page.getByRole('textbox', { name: 'Mã quét' }).press('Enter');
  await expect(page.getByText('1 Hộp = 24 chiếc')).toBeVisible();
  expect(calls).toBe(0);
  const confirm = page.getByRole('button', { name: 'Xác nhận nhập kho' });
  await confirm.dblclick();
  await expect(page.getByText('Đã nhập kho', { exact: true })).toBeVisible();
  await expect(page.getByText('124', { exact: true }).first()).toBeVisible();
  expect(calls).toBe(1);
  expect(db.inventoryReads()).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('button', { name: 'Xác nhận nhập kho' })).toHaveCount(0);
});

test('network failure preserves UUID and freezes inputs for an exact retry', async ({ page }) => {
  await setup(page);
  const bodies: Array<Record<string, string>> = [];
  await page.route('**/api/stock-movements', async route => {
    const body = route.request().postDataJSON() as Record<string, string>;
    bodies.push(body);
    if (bodies.length === 1) { await route.abort('failed'); return; }
    await route.fulfill({ status: 200, json: { data: { ...body, product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', quantity_base: '24', inventory_before: '100', inventory_after: '124' } } });
  });
  await page.goto('/stock-movement');
  await page.locator('.ant-select').click();
  await page.getByText('SCAN-01 — Cửa A').last().click();
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('BOX-ABC');
  await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
  await expect(page.getByText('Lượt nhập đang được giữ để thử lại')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mã quét' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Thử lại lượt nhập' })).toBeVisible();
  await page.getByRole('button', { name: 'Thử lại lượt nhập' }).click();
  await expect(page.getByText('Đã nhập kho', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});

test('VIEWER cannot access stock movement action', async ({ page }) => {
  await setup(page, 'VIEWER');
  await page.goto('/stock-movement');
  await expect(page.getByRole('button', { name: 'Xác nhận nhập kho' })).toHaveCount(0);
});

test('business conflict keeps the request and shows the backend message without fake success', async ({ page }) => {
  await setup(page, 'ADMIN');
  await page.route('**/api/stock-movements', route => route.fulfill({ status: 409, json: { message: 'Điểm quét đã ngừng hoạt động.' } }));
  await page.goto('/stock-movement');
  await page.locator('.ant-select').click();
  await page.getByText('SCAN-01 — Cửa A').last().click();
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('BOX-ABC');
  await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
  await expect(page.getByText('Điểm quét đã ngừng hoạt động.')).toBeVisible();
  await expect(page.getByText('Đã nhập kho', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Thử lại lượt nhập' })).toBeVisible();
});
