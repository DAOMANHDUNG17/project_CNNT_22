import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// Synthetic sessions only. All Auth/API traffic is intercepted before navigation.
const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const authUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
const storageKey = authUrl && `sb-${new URL(authUrl).hostname.split('.')[0]}-auth-token`;
const actor = { user_id: '1', username: 'synthetic', display_name: 'Người dùng thử', role: 'ADMIN' };
const target = { user_id: '9007199254740993', username: 'synthetic.staff', display_name: 'Nhân viên thử', email: 'staff@example.test', role: 'STAFF', is_active: true, created_at: '2026-11-25T00:00:00Z' };
const emptyPage = { data: [], count: 0, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
async function setup(page: Page, role = 'ADMIN', loggedIn = true) {
  test.skip(!storageKey, 'Local public Auth URL is needed to derive SDK storage key');
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', () => errors.push('pageerror'));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
      if (url.pathname === '/auth/v1/logout') return route.fulfill({ status: 204 });
      return route.abort();
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { ...actor, role } });
    if (url.pathname === '/api/account') return route.fulfill({ json: { ...actor, role, email: 'self@example.test' } });
    if (url.pathname === '/api/scan-points/my') return route.fulfill({ json: { data: [{ scan_point_id: 'SCAN-QA', point_name: 'Điểm tổng hợp', is_active: true }], count: 1 } });
    if (url.pathname.endsWith('/password')) {
      writes.push(url.pathname);
      return route.fulfill({ json: { changed: true, requires_relogin: url.pathname === '/api/account/password', refresh_sessions_revoked: true } });
    }
    if (url.pathname === '/api/users') return route.fulfill({ json: { ...emptyPage, data: [target], count: 1 } });
    return route.fulfill({ json: emptyPage });
  });
  if (loggedIn) await page.addInitScript(({ key }) => {
    if (sessionStorage.getItem('fixture-initialized')) return;
    sessionStorage.setItem('fixture-initialized', '1');
    localStorage.setItem(key, JSON.stringify({ access_token: 'fixture-jwt', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'self@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
  }, { key: storageKey! });
  return { writes, errors };
}
for (const role of ['ADMIN', 'STAFF', 'VIEWER']) test(`${role} opens settings through account menu, reloads own profile, no sidebar entry`, async ({ page }) => {
  const { errors } = await setup(page, role);
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Cài đặt tài khoản', exact: true })).toBeVisible();
  await expect(page.getByText('self@example.test', { exact: true })).toBeVisible();
  await expect(page.getByText('Điểm tổng hợp', { exact: true })).toBeVisible();
  await expect(page.locator('.desktop-sidebar').getByText('Cài đặt', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Menu tài khoản' }).click();
  await expect(page.getByRole('menuitem', { name: 'Cài đặt', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Cài đặt', exact: true }).click();
  await page.reload();
  await expect(page.getByText('self@example.test', { exact: true })).toBeVisible();
  if (role === 'ADMIN') await page.screenshot({ path: 'test-results/settings-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('settings requires login', async ({ page }) => {
  await setup(page, 'VIEWER', false); await page.goto('/settings');
  await expect(page).toHaveURL(/\/login$/);
});
test('self validation, visibility, single submit, clears SDK session and requires relogin', async ({ page }) => {
  const { writes, errors } = await setup(page, 'STAFF'); await page.goto('/settings');
  const current = page.getByLabel('Mật khẩu hiện tại', { exact: true });
  const next = page.getByLabel('Mật khẩu mới', { exact: true });
  const confirm = page.getByLabel('Xác nhận mật khẩu mới', { exact: true });
  await current.fill('synthetic-current'); await next.fill('short'); await confirm.fill('short');
  await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
  await expect(page.getByText('Mật khẩu mới phải có 8–128 ký tự.', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await next.fill('synthetic-current'); await confirm.fill('synthetic-current');
  await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
  await expect(page.getByText('Mật khẩu mới phải khác mật khẩu hiện tại.', { exact: true })).toBeVisible();
  await next.fill('synthetic-next-123'); await confirm.fill('synthetic-other-123');
  await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
  await expect(page.getByText('Xác nhận mật khẩu mới không khớp.', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await confirm.fill('synthetic-next-123');
  await expect(next).toHaveAttribute('type', 'password');
  await next.locator('..').locator('.ant-input-password-icon').click();
  await expect(next).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).dblclick();
  await expect(page).toHaveURL(/\/login$/);
  expect(writes).toEqual(['/api/account/password']);
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey!)).toBeNull();
  await page.reload(); await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Mật khẩu', { exact: true })).toHaveValue(''); expect(errors).toEqual([]);
});
test('ADMIN reset warns, validates confirmation, sends once and leaves own session unchanged', async ({ page }) => {
  const { writes, errors } = await setup(page); await page.goto('/users');
  await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(target.username, { exact: true })).toBeVisible();
  await expect(dialog.getByText(target.email, { exact: true })).toBeVisible();
  await dialog.getByLabel('Mật khẩu mới', { exact: true }).fill('synthetic-next-123');
  await dialog.getByLabel('Xác nhận mật khẩu mới', { exact: true }).fill('synthetic-next-123');
  await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(dialog.getByText('Vui lòng xác nhận thao tác đặt lại mật khẩu.', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(0);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Xác nhận', exact: true }).dblclick();
  await expect(dialog).toBeHidden(); expect(writes).toEqual([`/api/users/${target.user_id}/password`]);
  expect(await page.evaluate(key => !!localStorage.getItem(key), storageKey!)).toBe(true);
  await expect(page.getByRole('button', { name: 'Menu tài khoản' })).toContainText(actor.display_name); expect(errors).toEqual([]);
});
test('mobile settings fits viewport and keeps password controls reachable', async ({ page }) => {
  await setup(page, 'VIEWER'); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/settings');
  await expect(page.getByLabel('Mật khẩu hiện tại', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cập nhật mật khẩu' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/settings-mobile.png', fullPage: true });
});

test('wrong current password is shown in Vietnamese and does not sign out the user', async ({ page }) => {
  await setup(page, 'VIEWER');
  await page.route('**/api/account/password', route => route.fulfill({ status: 400, json: { message: 'Mật khẩu hiện tại không đúng.' } }));
  await page.goto('/settings');
  await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill('synthetic-wrong');
  await page.getByLabel('Mật khẩu mới', { exact: true }).fill('synthetic-next-123');
  await page.getByLabel('Xác nhận mật khẩu mới', { exact: true }).fill('synthetic-next-123');
  await page.getByRole('button', { name: 'Cập nhật mật khẩu' }).click();
  await expect(page.getByText('Mật khẩu hiện tại không đúng.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  expect(await page.evaluate(key => !!localStorage.getItem(key), storageKey!)).toBe(true);
});
test('ADMIN self reset navigates to personal settings without sending a password request', async ({ page }) => {
  const { writes } = await setup(page);
  await page.route(/\/api\/users(?:\?|$)/, route => route.fulfill({ json: { ...emptyPage, data: [{ ...target, ...actor, email: 'self@example.test' }], count: 1 } }));
  await page.goto('/users');
  await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/); await expect(page.getByRole('dialog')).toHaveCount(0); expect(writes).toEqual([]);
});
for (const role of ['STAFF', 'VIEWER']) test(`${role} cannot open ADMIN password management UI`, async ({ page }) => {
  const { writes } = await setup(page, role); await page.goto('/users');
  await expect(page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: /Quản lý người dùng/ })).toHaveCount(0); expect(writes).toEqual([]);
});
