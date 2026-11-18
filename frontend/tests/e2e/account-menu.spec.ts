import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

for (const stalledFrames of [false, true]) {
  test(`account menu stays in view and signs out${stalledFrames ? ' when layout callbacks stall' : ''}`, async ({ page }) => {
    test.skip(!storageKey, 'Supabase URL required for isolated browser session');
    await page.addInitScript(({ key, stalled }) => {
      if (stalled) {
        window.requestAnimationFrame = () => 1;
        window.cancelAnimationFrame = () => {};
        window.ResizeObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
      }
      if (sessionStorage.getItem('account-menu-fixture-seeded')) return;
      sessionStorage.setItem('account-menu-fixture-seeded', '1');
      localStorage.setItem(key, JSON.stringify({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } }));
    }, { key: storageKey!, stalled: stalledFrames });
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user_id: '1', username: 'qa', display_name: 'QA User', role: 'ADMIN' } }));
    await page.route('**/api/scan-points/my', route => route.fulfill({ json: { data: [], count: 0 } }));
    await page.route('**/auth/v1/logout*', route => route.fulfill({ status: 204 }));
    await page.goto('/403');
    const account = page.getByRole('button', { name: 'Menu tài khoản' });
    const logout = page.getByRole('menuitem', { name: 'Đăng xuất' });
    await account.click();
    await expect(logout).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(logout).toBeHidden();
    await account.focus();
    await account.press('Enter');
    await expect(logout).toBeInViewport();
    await logout.click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey!)).toBeNull();
    await page.goto('/403');
    await expect(page).toHaveURL(/\/login$/);
  });
}
