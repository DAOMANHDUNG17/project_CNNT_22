import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

async function session(page: import('@playwright/test').Page) {
  test.skip(!storageKey, 'Supabase URL required for isolated browser session');
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
  }, { key: storageKey! });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user_id: '1', username: 'qa', display_name: 'QA', role: 'ADMIN' } }));
}

const payload = (page: number, granularity: string) => ({
  summary: { products: { total: '2', active: '1', inactive: '1', missing_inventory: '1' }, inventory_totals: [{ base_unit: 'Hộp', quantity_base: '9007199254740993' }], transactions: { IN: '1', OUT: '0', total: '1' }, low_stock: { threshold: '10', product_count: '1' } },
  trends: [{ period_start: granularity === 'month' ? '2026-11-01T00:00:00Z' : '2026-11-14T00:00:00Z', in_count: '1', out_count: '0', total_count: '1' }],
  top: { data: [{ product_id: page === 1 ? 'SP013' : 'SP014', product_name: page === 1 ? 'Paper' : 'Pens', base_unit: 'Hộp', transaction_count: '1', in_count: '1', out_count: '0', quantity_in_base: '10', quantity_out_base: '0' }], count: 6, pagination: { page, limit: 5, total: 6, totalPages: 2 } },
  latest: [{ transaction_id: 'one', product_name: 'Paper', movement_type: 'IN', quantity_packages: 1, unit_name: 'Hộp', point_name: 'Gate', created_at: '2026-11-14T00:00:00Z' }],
  low_stock: [{ product_id: 'SP013', product_name: 'Paper', base_unit: 'Hộp', quantity_base: '0' }],
});

test('Dashboard loads authorized data, filters chart, paginates and refreshes using GET only', async ({ page }) => {
  await session(page);
  const queries: URLSearchParams[] = [];
  const methods: string[] = [];
  await page.route('**/api/dashboard?**', async route => {
    const request = route.request();
    methods.push(request.method());
    expect(request.headers().authorization).toBe('Bearer fixture-token');
    const params = new URL(request.url()).searchParams;
    queries.push(params);
    if (queries.length === 1) await new Promise(resolve => setTimeout(resolve, 300));
    await route.fulfill({ json: payload(Number(params.get('page')), params.get('granularity') ?? 'day') });
  });
  await page.goto('/');
  await expect(page.locator('.stat-card .ant-skeleton').first()).toBeVisible();
  await expect(page.locator('.stat-card').first()).toContainText('2');
  await expect(page.getByText('Tồn kho theo đơn vị', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('img', { name: /Biểu đồ số lượt nhập/ })).toBeVisible();
  await expect(page.getByText('Paper').first()).toBeVisible();
  await page.getByRole('combobox', { name: 'Nhóm biểu đồ' }).click();
  await page.getByTitle('Theo tháng').click();
  await expect.poll(() => queries.at(-1)?.get('granularity')).toBe('month');
  const dates = page.locator('.chart-card .ant-picker-input input');
  await dates.first().fill('01/11/2026');
  await dates.first().press('Enter');
  await dates.nth(1).fill('14/11/2026');
  await dates.nth(1).press('Enter');
  await expect.poll(() => queries.at(-1)?.get('from')).toBe('2026-11-01');
  expect(queries.at(-1)?.get('to')).toBe('2026-11-14');
  await page.locator('.data-table .ant-pagination-next button').click();
  await expect.poll(() => queries.at(-1)?.get('page')).toBe('2');
  await expect(page.getByText('Pens')).toBeVisible();
  await page.getByRole('button', { name: 'Làm mới' }).click();
  await expect.poll(() => queries.length).toBeGreaterThanOrEqual(4);
  expect(methods.every(method => method === 'GET')).toBe(true);
});

test('Dashboard error exposes retry and no fabricated numbers', async ({ page }) => {
  await session(page);
  let failed = true;
  await page.route('**/api/dashboard?**', route => failed ? route.fulfill({ status: 500, json: { message: 'Unavailable' } }) : route.fulfill({ json: payload(1, 'day') }));
  await page.goto('/');
  await expect(page.locator('.error-notice')).toBeVisible();
  await expect(page.locator('.stat-value').first()).toHaveText('—');
  await expect(page.getByText('Paper')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Paper').first()).toBeVisible();
  await expect(page.locator('.error-notice')).toHaveCount(0);
});
