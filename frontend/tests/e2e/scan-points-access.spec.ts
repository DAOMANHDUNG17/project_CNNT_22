import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

async function session(page: import('@playwright/test').Page, role: 'ADMIN' | 'STAFF' | 'VIEWER') {
  test.skip(!storageKey, 'Supabase URL required for isolated browser session');
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
  }, { key: storageKey! });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user_id: '1', username: 'qa', display_name: 'QA User', role } }));
}

test('ADMIN sees unassigned station, management menu and read-only details modal', async ({ page }) => {
  await session(page, 'ADMIN');
  const methods: string[] = [];
  await page.route('**/api/scan-points', route => {
    methods.push(route.request().method());
    return route.fulfill({ json: { data: [{ scan_point_id: 'SCAN-01', point_name: 'Quầy nhận hàng', is_active: true, created_at: '2026-11-15T00:00:00Z' }], count: 1 } });
  });
  await page.goto('/scan-points');
  await expect(page.locator('.station-status')).toContainText('Chưa gán điểm quét');
  await expect(page.locator('.station-status')).not.toContainText('SCAN-01');
  await expect(page.getByRole('menuitem', { name: /Quản lý điểm quét/ })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'SCAN-01' })).toBeVisible();
  await page.getByRole('button', { name: 'Xem chi tiết' }).click();
  await expect(page.getByRole('dialog', { name: 'Chi tiết điểm quét' })).toContainText('Quầy nhận hàng');
  await expect(page.getByRole('dialog').getByRole('button', { name: /sửa|thêm|bật|tắt/i })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Menu tài khoản' }).click();
  await expect(page.getByRole('menuitem', { name: 'Đăng xuất' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /QA User/ })).toContainText('Quản trị viên');
  expect(methods).toEqual(['GET']);
  await expect(page.getByRole('link', { name: /Cấu hình SCAN-01/ })).toHaveCount(0);
});

for (const role of ['STAFF', 'VIEWER'] as const) {
  test(`${role} sees station status but no management menu or direct URL access`, async ({ page }) => {
    await session(page, role);
    let scanPointRequests = 0;
    page.on('request', request => { if (request.url().endsWith('/api/scan-points')) scanPointRequests++; });
    await page.goto('/scan-points');
    await expect(page.locator('.station-status')).toContainText('Chưa gán điểm quét');
    await expect(page.getByRole('menuitem', { name: /Quản lý điểm quét/ })).toHaveCount(0);
    await expect(page.getByText('Bạn chưa có quyền truy cập')).toBeVisible();
    await expect(page.getByRole('button', { name: /Xem chi tiết|Thêm|Sửa|Bật|Tắt/i })).toHaveCount(0);
    expect(scanPointRequests).toBe(0);
    await page.getByRole('button', { name: 'Menu tài khoản' }).click();
    await expect(page.getByRole('menuitem', { name: 'Đăng xuất' })).toBeVisible();
  });
}

test('station status and account menu fit a narrow header', async ({ page }) => {
  await session(page, 'ADMIN');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/403');
  await expect(page.locator('.station-status')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menu tài khoản' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(page.locator('.station-status')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Mở menu' }).click();
  await expect(page.getByRole('menuitem', { name: /Quản lý điểm quét/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Menu tài khoản' }).click();
  await expect(page.getByRole('menuitem', { name: /QA User/ })).toContainText('Quản trị viên');
});
