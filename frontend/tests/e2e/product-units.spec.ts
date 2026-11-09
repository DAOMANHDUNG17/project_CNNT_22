import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const envFile = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(envFile)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

test('ADMIN adds a product unit using bearer POST and refreshes the database list', async ({ page }) => {
  test.skip(!storageKey, 'A Supabase URL is needed to initialize the local test session');
  const token = 'local-e2e-access-token';
  await page.addInitScript(({ key, accessToken }) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: accessToken, refresh_token: 'local-e2e-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
        email: 'admin@example.test', app_metadata: {}, user_metadata: {},
        created_at: '2026-01-01T00:00:00.000Z' },
    }));
  }, { key: storageKey!, accessToken: token });

  const product = {
    product_id: 'SP013', product_name: 'Product 13', base_unit: 'piece', is_active: true,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  };
  const baseUnit = {
    product_unit_id: '28', product_id: 'SP013', product_name: 'Product 13', unit_name: 'piece',
    conversion_factor: 1, scan_code: 'SW-SP013-01', is_base_unit: true, created_at: '2026-01-01T00:00:00.000Z',
  };
  const addedUnit = {
    ...baseUnit, product_unit_id: '29', unit_name: 'box', conversion_factor: 20,
    scan_code: 'SW-SP013-20', is_base_unit: false,
  };
  let units = [baseUnit];
  let getCount = 0;
  let posted = false;
  let failNext = false;
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    user_id: '42', username: 'admin', display_name: 'Admin', role: 'ADMIN',
  } }));
  await page.route('**/api/products', route => route.fulfill({ json: { data: [product], count: 1 } }));
  await page.route('**/api/product-units', async route => {
    if (route.request().method() === 'GET') {
      getCount++;
      await route.fulfill({ json: { data: units, count: units.length } });
      return;
    }
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    if (failNext) {
      await route.fulfill({ status: 409, json: { message: 'Scan code already exists' } });
      return;
    }
    expect(route.request().postDataJSON()).toEqual({
      product_id: 'SP013', unit_name: 'box', conversion_factor: 20,
      scan_code: 'SW-SP013-20', is_base_unit: false,
    });
    posted = true;
    units = [baseUnit, addedUnit];
    await route.fulfill({ status: 201, json: { data: addedUnit } });
  });

  await page.goto('/products');
  await page.getByRole('button', { name: 'SP013' }).click();
  await expect(page.getByRole('cell', { name: 'SW-SP013-01' })).toBeVisible();
  await page.getByRole('button', { name: 'Thêm đơn vị đóng gói / mã quét' }).click();
  await page.getByRole('textbox', { name: 'Đơn vị', exact: true }).fill('box');
  await page.getByRole('spinbutton', { name: /Hệ số quy đổi/ }).fill('20');
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('SW-SP013-20');
  await page.getByRole('button', { name: 'Lưu đơn vị' }).click();
  await expect(page.getByRole('cell', { name: 'SW-SP013-20' })).toBeVisible();
  expect(posted).toBe(true);
  expect(getCount).toBeGreaterThanOrEqual(2);

  failNext = true;
  const refreshedCount = getCount;
  await page.getByRole('button', { name: 'Thêm đơn vị đóng gói / mã quét' }).click();
  await page.getByRole('textbox', { name: 'Đơn vị', exact: true }).fill('carton');
  await page.getByRole('spinbutton', { name: /Hệ số quy đổi/ }).fill('50');
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('SW-SP013-20');
  await page.getByRole('button', { name: 'Lưu đơn vị' }).click();
  await expect(page.getByText('Mã quét đã tồn tại. Vui lòng nhập mã khác.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Thêm đơn vị đóng gói / mã quét' })).toBeVisible();
  expect(getCount).toBe(refreshedCount);
  await expect(page.getByRole('cell', { name: 'SW-SP013-20' })).toHaveCount(1);
});
