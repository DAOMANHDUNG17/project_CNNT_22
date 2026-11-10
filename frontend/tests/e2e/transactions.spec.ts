import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const id = 'f3a754fd-df1d-4d7f-8220-411f07415070';
const row = {
  transaction_id: id, product_id: 'SP013', product_name: 'Current Product', product_unit_id: '9007199254740993',
  unit_name: 'Current Box', movement_type: 'IN', quantity_packages: 1, conversion_factor_snapshot: 24,
  quantity_base: '24', inventory_before: '9007199254740993', inventory_after: '9007199254741017',
  scan_code_snapshot: 'OLD-SNAPSHOT-CODE', scan_point_id: 'SCAN-01', point_name: 'Inactive gate',
  user_id: '9007199254740994', display_name: 'Operator', created_at: '2026-11-09T22:03:59Z',
};

async function session(page: import('@playwright/test').Page, role: string) {
  test.skip(!storageKey, 'Supabase URL required for isolated browser session');
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
  }, { key: storageKey! });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user_id: '1', username: 'qa', display_name: 'QA', role } }));
  await page.route('**/api/scan-points', route => route.fulfill({ json: { data: [{ scan_point_id: 'SCAN-01', point_name: 'Inactive gate', is_active: false }], count: 1 } }));
}

test('VIEWER reads history, paginates, filters, opens snapshots and copies full UUID without POST', async ({ page, context }) => {
  await session(page, 'VIEWER');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const queries: URLSearchParams[] = [];
  let posts = 0;
  page.on('request', request => { if (request.url().includes('/api/') && request.method() !== 'GET') posts++; });
  await page.route('**/api/transactions**', route => {
    expect(route.request().headers().authorization).toBe('Bearer fixture-token');
    const params = new URL(route.request().url()).searchParams; queries.push(params);
    const filtered = params.has('transactionId') || params.has('productId');
    return route.fulfill({ json: { data: [row], count: filtered ? 1 : 21, pagination: { page: Number(params.get('page') ?? 1), limit: 20, total: filtered ? 1 : 21, totalPages: filtered ? 1 : 2 } } });
  });
  await page.goto('/transactions');
  await expect(page.getByRole('cell', { name: '+24', exact: true })).toBeVisible();
  await expect(page.getByText('05:03 10/11/2026')).toBeVisible();
  await page.locator('.ant-pagination-next button').click();
  await expect.poll(() => queries.at(-1)?.get('page')).toBe('2');
  await page.getByRole('textbox', { name: 'Lọc mã sản phẩm' }).fill('SP013');
  await expect.poll(() => queries.at(-1)?.get('productId')).toBe('SP013');
  expect(queries.at(-1)?.get('page')).toBe('1');
  await page.getByRole('textbox', { name: 'Tìm UUID giao dịch' }).fill(id);
  await expect.poll(() => queries.at(-1)?.get('transactionId')).toBe(id);
  await page.getByRole('button', { name: 'Chi tiết', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Chi tiết giao dịch' });
  await expect(drawer.getByText(id, { exact: true })).toBeVisible();
  await expect(drawer.getByText('OLD-SNAPSHOT-CODE')).toBeVisible();
  await expect(drawer.getByText('9.007.199.254.740.993', { exact: true })).toBeVisible();
  await expect(drawer.getByText('24', { exact: true }).first()).toBeVisible();
  await drawer.getByRole('button', { name: 'Copy UUID', exact: true }).click();
  await expect(page.getByText('Đã sao chép đầy đủ UUID.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
  expect(posts).toBe(0);
});

test('ADMIN filters OUT, inactive point and Vietnam dates, then resets filters', async ({ page }) => {
  await session(page, 'ADMIN');
  let last = new URLSearchParams();
  await page.route('**/api/transactions**', route => {
    last = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { data: [], count: 0, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } });
  });
  await page.goto('/transactions');
  await page.getByRole('combobox', { name: 'Loại giao dịch' }).click();
  await page.getByTitle('Xuất kho', { exact: true }).click();
  await expect.poll(() => last.get('movementType')).toBe('OUT');
  await page.getByRole('combobox', { name: 'Lọc điểm quét' }).click();
  await page.getByTitle('SCAN-01 · Inactive gate', { exact: true }).click();
  await expect.poll(() => last.get('scanPointId')).toBe('SCAN-01');
  await page.getByPlaceholder('Từ ngày (UTC+7)').fill('10/11/2026');
  await page.getByPlaceholder('Từ ngày (UTC+7)').press('Enter');
  await page.getByPlaceholder('Đến hết ngày (UTC+7)').fill('11/11/2026');
  await page.getByPlaceholder('Đến hết ngày (UTC+7)').press('Enter');
  await expect.poll(() => last.get('from')).toBe('2026-11-09T17:00:00.000Z');
  expect(last.get('to')).toBe('2026-11-11T17:00:00.000Z');
  await page.getByRole('button', { name: 'Xóa bộ lọc' }).click();
  await expect.poll(() => last.has('movementType') || last.has('scanPointId') || last.has('from')).toBe(false);
  await expect(page.getByText('Chưa có dữ liệu phù hợp')).toBeVisible();
});

test('history errors and invalid UUID never fall back to mock data', async ({ page }) => {
  await session(page, 'STAFF');
  await page.route('**/api/transactions**', route => route.fulfill({ status: 500, json: { message: 'Unavailable' } }));
  await page.goto('/transactions');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Current Product' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Tìm UUID giao dịch' }).fill('bad');
  await expect(page.getByText('Nhập UUID hợp lệ gồm 36 ký tự để tìm chính xác giao dịch.')).toBeVisible();
});
