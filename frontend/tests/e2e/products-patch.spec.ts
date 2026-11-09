import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const envFile = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(envFile)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const token = 'local-patch-e2e-token';

async function localSession(page: Page) {
  test.skip(!storageKey, 'A Supabase URL is needed for the local test session');
  await page.addInitScript(({ key, accessToken }) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: accessToken, refresh_token: 'local-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
        email: 'admin@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' },
    }));
  }, { key: storageKey!, accessToken: token });
}

const initialProduct = {
  product_id: 'SP013', product_name: 'Bút mực', base_unit: 'cây', is_active: true,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
};

test('ADMIN edits a product through bearer PATCH, refreshes Drawer, and keeps form on 409', async ({ page }) => {
  await localSession(page);
  let product = initialProduct;
  let getCount = 0;
  let patchCount = 0;
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    user_id: '42', username: 'admin', display_name: 'Admin', role: 'ADMIN',
  } }));
  await page.route('**/api/products', async route => {
    expect(route.request().method()).toBe('GET');
    getCount++;
    await route.fulfill({ json: { data: [product], count: 1 } });
  });
  await page.route('**/api/products/SP013', async route => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    patchCount++;
    if (patchCount === 1) {
      expect(route.request().postDataJSON()).toEqual({ product_name: 'Bút mực Hồng Hà' });
      product = { ...product, product_name: 'Bút mực Hồng Hà', updated_at: '2026-01-03T00:00:00.000Z' };
      await route.fulfill({ json: { data: product } });
    } else {
      expect(route.request().postDataJSON()).toEqual({ is_active: false });
      await route.fulfill({ status: 409, json: { message: 'Không thể ngừng hoạt động sản phẩm khi vẫn còn tồn kho.' } });
    }
  });
  await page.route('**/api/product-units', route => route.fulfill({ json: { data: [], count: 0 } }));

  await page.goto('/products');
  await page.getByRole('button', { name: 'SP013' }).click();
  await page.getByRole('button', { name: 'Chỉnh sửa sản phẩm' }).click();
  const editor = page.getByRole('dialog', { name: 'Chỉnh sửa sản phẩm' });
  await expect(editor.getByRole('textbox', { name: 'Mã sản phẩm' })).toHaveValue('SP013');
  await expect(editor.getByRole('textbox', { name: 'Đơn vị cơ sở' })).toHaveValue('cây');
  await editor.getByRole('textbox', { name: 'Tên sản phẩm' }).fill('Bút mực Hồng Hà');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.locator('tr[data-row-key="SP013"]')).toContainText('Bút mực Hồng Hà');
  await expect(page.getByText('Bút mực Hồng Hà', { exact: true })).toHaveCount(2);
  expect(getCount).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'Chỉnh sửa sản phẩm' }).click();
  await editor.locator('.ant-switch').click();
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('button', { name: 'Xác nhận ngừng' })).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận ngừng' }).click();
  await expect(page.getByText('Không thể ngừng hoạt động sản phẩm khi vẫn còn tồn kho.')).toBeVisible();
  await expect(editor).toBeVisible();
  expect(patchCount).toBe(2);
  expect(product.is_active).toBe(true);
});

test('STAFF and VIEWER cannot see the product edit action', async ({ page }) => {
  await localSession(page);
  let role = 'STAFF';
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    user_id: '42', username: 'reader', display_name: 'Reader', role,
  } }));
  await page.route('**/api/products', route => route.fulfill({ json: { data: [initialProduct], count: 1 } }));
  await page.route('**/api/product-units', route => route.fulfill({ json: { data: [], count: 0 } }));
  for (const nextRole of ['STAFF', 'VIEWER']) {
    role = nextRole;
    await page.goto('/products');
    await page.getByRole('button', { name: 'SP013' }).click();
    await expect(page.getByRole('button', { name: 'Chỉnh sửa sản phẩm' })).toHaveCount(0);
    await page.reload();
  }
});
