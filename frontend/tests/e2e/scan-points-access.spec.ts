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
  await page.route('**/api/scan-points/my', route => route.fulfill({ json: { data: [], count: 0 } }));
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

for (const role of ['ADMIN', 'STAFF'] as const) test(`${role} header shows only backend-assigned point and its name tooltip`, async ({ page }) => {
  await session(page, role); let reads = 0;
  await page.route('**/api/scan-points/my', route => {
    reads++; expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).search).toBe('');
    return route.fulfill({ json: { data: [{ scan_point_id: 'SCAN-01', point_name: 'Quầy nhận hàng', is_active: true }], count: 1 } });
  });
  await page.goto('/403');
  const badge = page.locator('.station-status');
  await expect(badge).toContainText('SCAN-01'); await expect(badge).not.toContainText('Chưa gán điểm quét');
  await expect(badge.getByRole('combobox')).toHaveCount(0);
  await badge.hover(); await expect(page.getByRole('tooltip')).toContainText('SCAN-01 — Quầy nhận hàng');
  expect(reads).toBe(1);
  await page.getByRole('button', { name: 'Menu tài khoản' }).click(); await expect(page.getByRole('menuitem', { name: 'Đăng xuất' })).toBeVisible();
});

test('header loading/error/retry never represents a failed permission request as unassigned', async ({ page }) => {
  await session(page, 'STAFF'); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let attempts = 0;
  await page.route('**/api/scan-points/my', async route => {
    attempts++; if (attempts === 1) { await gate; return route.fulfill({ status: 503, json: { message: 'Không tải được điểm quét đã cấp quyền.' } }); }
    return route.fulfill({ json: { data: [{ scan_point_id: 'SCAN-02', point_name: 'Cửa xuất', is_active: true }], count: 1 } });
  });
  await page.goto('/403'); const badge = page.locator('.station-status');
  await expect(badge).toContainText('Đang tải điểm quét'); release();
  await expect(badge).toContainText('Chưa tải được điểm quét'); await expect(badge).not.toContainText('Chưa gán điểm quét');
  await badge.getByRole('button', { name: 'Tải lại điểm quét được phân công' }).click();
  await expect(badge).toContainText('SCAN-02'); expect(attempts).toBe(2);
});

test('multiple ADMIN grants fit the mobile header without selecting a point for the account', async ({ page }) => {
  await session(page, 'ADMIN');
  const ids = ['SCAN-POINT-0000000001', 'SCAN-POINT-0000000002'];
  await page.route('**/api/scan-points/my', route => route.fulfill({ json: { data: ids.map(id => ({ scan_point_id: id, point_name: 'Được cấp quyền', is_active: true })), count: 2 } }));
  await page.setViewportSize({ width: 320, height: 700 }); await page.goto('/403');
  await expect(page.locator('.station-status')).toContainText(ids.join(', '));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect(page.getByRole('button', { name: 'Menu tài khoản' })).toBeVisible();
});

test('legacy multiple STAFF grants are flagged instead of displaying an arbitrary point', async ({ page }) => {
  await session(page, 'STAFF');
  await page.route('**/api/scan-points/my', route => route.fulfill({ json: { data: ['SCAN-01', 'SCAN-02'].map(id => ({ scan_point_id: id, point_name: id, is_active: true })), count: 2 } }));
  await page.goto('/403'); await expect(page.locator('.station-status')).toContainText('Phân công chưa hợp lệ');
  await expect(page.locator('.station-status')).not.toContainText('SCAN-01');
});

test('saving own ADMIN grants refreshes the header immediately', async ({ page }) => {
  await session(page, 'ADMIN');
  const point = { scan_point_id: 'SCAN-01', point_name: 'Quầy nhận hàng', is_active: true };
  let assigned = false;
  await page.route('**/api/scan-points', route => route.fulfill({ json: { data: [point], count: 1 } }));
  await page.route('**/api/scan-points/my', route => route.fulfill({ json: { data: assigned ? [point] : [], count: assigned ? 1 : 0 } }));
  await page.route('**/api/users**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/scan-points')) {
      if (route.request().method() === 'PUT') { expect(route.request().postDataJSON()).toEqual({ scan_point_ids: ['SCAN-01'] }); assigned = true; }
      return route.fulfill({ json: { data: assigned ? [{ ...point, user_id: '1', scan_point_is_active: true, assigned_by: '1', assigned_at: '2026-11-16T00:00:00Z' }] : [], count: assigned ? 1 : 0 } });
    }
    expect(route.request().method()).toBe('GET');
    return route.fulfill({ json: { data: [{ user_id: '1', auth_user_id: '00000000-0000-4000-8000-000000000001', username: 'qa', display_name: 'QA User', email: 'qa@example.test', role: 'ADMIN', is_active: true, created_at: '2026-11-16T00:00:00Z', updated_at: '2026-11-16T00:00:00Z' }], count: 1, pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } } });
  });
  await page.goto('/users'); await expect(page.locator('.station-status')).toContainText('Chưa gán điểm quét');
  await page.getByRole('button', { name: 'Sửa người dùng', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('checkbox', { name: /^SCAN-01/ }).check();
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).click();
  await expect(dialog).toBeHidden(); await expect(page.locator('.station-status')).toContainText('SCAN-01');
});
