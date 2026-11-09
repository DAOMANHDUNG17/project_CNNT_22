import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const envFile = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(envFile)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const token = 'local-unit-patch-e2e-token';

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

const product = {
  product_id: 'SP013', product_name: 'Bút mực', base_unit: 'cây', is_active: true,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
};
const unit = {
  product_unit_id: '9007199254740993', product_id: 'SP013', product_name: 'Bút mực',
  unit_name: 'hộp', conversion_factor: 20, scan_code: 'SW-SP013-OLD', is_base_unit: false,
  created_at: '2026-01-01T00:00:00.000Z',
};

test('ADMIN edits a unit through bearer PATCH, confirms scan code, and refreshes the Drawer', async ({ page }) => {
  await localSession(page);
  let current = unit;
  let getCount = 0;
  let patchCount = 0;
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    user_id: '42', username: 'admin', display_name: 'Admin', role: 'ADMIN',
  } }));
  await page.route('**/api/products', route => route.fulfill({ json: { data: [product], count: 1 } }));
  await page.route('**/api/product-units', route => {
    getCount++;
    return route.fulfill({ json: { data: [current], count: 1 } });
  });
  await page.route('**/api/product-units/9007199254740993', async route => {
    expect(route.request().method()).toBe('PATCH');
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    patchCount++;
    const body = route.request().postDataJSON();
    if (body.scan_code === 'SW-SP013-TAKEN') {
      await route.fulfill({ status: 409, json: { message: 'Scan code already exists' } });
      return;
    }
    if (body.conversion_factor === 120) {
      await route.fulfill({ status: 409, json: {
        message: 'Không thể thay đổi hệ số quy đổi vì đơn vị này đã phát sinh giao dịch nhập/xuất.',
      } });
      return;
    }
    if (body.conversion_factor === 121) {
      await route.abort('failed');
      return;
    }
    current = { ...current, ...body };
    await route.fulfill({ json: { data: current } });
  });

  await page.goto('/products');
  await page.getByRole('button', { name: 'SP013' }).click();
  await page.getByRole('button', { name: 'Chỉnh sửa đơn vị' }).click();
  const editor = page.getByRole('dialog', { name: 'Chỉnh sửa đơn vị' });
  await expect(editor.getByRole('textbox', { name: 'ID đơn vị' })).toHaveValue(unit.product_unit_id);
  await expect(editor.getByRole('textbox', { name: 'Sản phẩm' })).toHaveValue('SP013 — Bút mực');
  await expect(editor.getByRole('textbox', { name: 'Đơn vị', exact: true })).toHaveValue('hộp');
  await expect(editor.getByRole('spinbutton', { name: /Hệ số quy đổi/ })).toHaveValue('20');

  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Không có thay đổi để lưu')).toBeVisible();
  expect(patchCount).toBe(0);
  await editor.getByRole('textbox', { name: 'Đơn vị', exact: true }).fill('   ');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(editor.getByText('Nhập 1–30 ký tự.')).toBeVisible();
  expect(patchCount).toBe(0);
  await editor.getByRole('textbox', { name: 'Đơn vị', exact: true }).fill('hộp');
  await editor.getByRole('textbox', { name: 'Mã quét' }).fill('   ');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(editor.getByText('Nhập 1–80 ký tự.')).toBeVisible();
  expect(patchCount).toBe(0);
  await editor.getByRole('textbox', { name: 'Mã quét' }).fill('SW-SP013-OLD');

  await editor.getByRole('textbox', { name: 'Đơn vị', exact: true }).fill('Hộp lớn');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('cell', { name: 'Hộp lớn' })).toBeVisible();
  expect(current.unit_name).toBe('Hộp lớn');
  expect(getCount).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'Chỉnh sửa đơn vị' }).click();
  await editor.getByRole('textbox', { name: 'Mã quét' }).fill('SW-SP013-TAKEN');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Thay đổi mã quét có thể khiến các tem mã vạch cũ không còn sử dụng được. Hãy cập nhật tem trên hàng hóa.')).toBeVisible();
  await page.getByRole('button', { name: 'Hủy' }).last().click();
  expect(patchCount).toBe(1);
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await page.getByRole('button', { name: 'Xác nhận thay đổi' }).click();
  await expect(page.getByText('Mã quét đã tồn tại. Vui lòng nhập mã khác.')).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(page.getByRole('cell', { name: 'SW-SP013-OLD' })).toBeVisible();

  await editor.getByRole('textbox', { name: 'Mã quét' }).fill('SW-SP013-NEW');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await page.getByRole('button', { name: 'Xác nhận thay đổi' }).click();
  await expect(page.getByRole('cell', { name: 'SW-SP013-NEW' })).toBeVisible();
  expect(current.scan_code).toBe('SW-SP013-NEW');
  expect(patchCount).toBe(3);

  await page.getByRole('button', { name: 'Chỉnh sửa đơn vị' }).click();
  await editor.getByRole('spinbutton', { name: /Hệ số quy đổi/ }).fill('120');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Không thể thay đổi hệ số quy đổi vì đơn vị này đã phát sinh giao dịch nhập/xuất.')).toBeVisible();
  await expect(editor).toBeVisible();
  expect(current.conversion_factor).toBe(20);
  await editor.getByRole('spinbutton', { name: /Hệ số quy đổi/ }).fill('121');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByText('Không nhận được phản hồi từ máy chủ. Kiểm tra kết nối và thử lại.')).toBeVisible();
  await expect(editor).toBeVisible();
  expect(current.conversion_factor).toBe(20);
});

test('STAFF and VIEWER cannot see the unit edit action', async ({ page }) => {
  await localSession(page);
  let role = 'STAFF';
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    user_id: '42', username: 'reader', display_name: 'Reader', role,
  } }));
  await page.route('**/api/products', route => route.fulfill({ json: { data: [product], count: 1 } }));
  await page.route('**/api/product-units', route => route.fulfill({ json: { data: [unit], count: 1 } }));
  for (const nextRole of ['STAFF', 'VIEWER']) {
    role = nextRole;
    await page.goto('/products');
    await page.getByRole('button', { name: 'SP013' }).click();
    await expect(page.getByRole('button', { name: 'Chỉnh sửa đơn vị' })).toHaveCount(0);
    await page.reload();
  }
});

test('ADMIN confirms a base unit rename and refreshes product and unit data', async ({ page }) => {
  await localSession(page);
  let current = { ...unit, unit_name: 'Cây\n', is_base_unit: true, conversion_factor: 1 };
  let currentProduct = { ...product };
  let patchCount = 0;
  let unitGets = 0;
  let productGets = 0;
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    user_id: '42', username: 'admin', display_name: 'Admin', role: 'ADMIN',
  } }));
  await page.route('**/api/products', route => {
    productGets++;
    return route.fulfill({ json: { data: [currentProduct], count: 1 } });
  });
  await page.route('**/api/product-units', route => {
    unitGets++;
    return route.fulfill({ json: { data: [current], count: 1 } });
  });
  await page.route('**/api/product-units/9007199254740993', async route => {
    patchCount++;
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    const patch = route.request().postDataJSON();
    if (patch.unit_name === 'Cái') {
      await route.fulfill({ status: 409, json: { message: 'Unit name already exists for this product' } });
      return;
    }
    if (patch.unit_name) currentProduct = { ...currentProduct, base_unit: patch.unit_name };
    current = { ...current, ...patch };
    await route.fulfill({ json: { data: current } });
  });

  await page.goto('/products');
  await page.getByRole('button', { name: 'SP013' }).click();
  await page.getByRole('button', { name: 'Chỉnh sửa đơn vị' }).click();
  const editor = page.getByRole('dialog', { name: 'Chỉnh sửa đơn vị' });
  await expect(editor.getByRole('textbox', { name: 'Đơn vị', exact: true })).toHaveJSProperty('readOnly', false);
  await expect(editor.getByRole('spinbutton', { name: /Hệ số quy đổi/ })).toBeDisabled();
  const warning = 'Chỉ đổi cách gọi của cùng một đơn vị cơ sở. Không sử dụng chức năng này để thay đổi quy cách đóng gói hoặc số lượng quy đổi.';
  await expect(editor.getByText(warning)).toBeVisible();
  await editor.getByRole('textbox', { name: 'Đơn vị', exact: true }).fill('Chiếc');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('dialog', { name: 'Xác nhận đổi tên đơn vị cơ sở?' }).getByText(warning)).toBeVisible();
  await page.getByRole('dialog', { name: 'Xác nhận đổi tên đơn vị cơ sở?' }).getByRole('button', { name: 'Hủy' }).click();
  expect(patchCount).toBe(0);
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await page.getByRole('button', { name: 'Xác nhận thay đổi' }).click();
  await expect(page.locator('tr[data-row-key="9007199254740993"]').getByRole('cell', { name: 'Chiếc', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Đơn vị cơ sở Chiếc/ })).toBeVisible();
  expect(currentProduct.base_unit).toBe('Chiếc');
  expect(current.unit_name).toBe('Chiếc');
  expect(patchCount).toBe(1);
  expect(unitGets).toBeGreaterThanOrEqual(2);
  expect(productGets).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'Chỉnh sửa đơn vị' }).click();
  await editor.getByRole('textbox', { name: 'Đơn vị', exact: true }).fill('Cái');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await page.getByRole('button', { name: 'Xác nhận thay đổi' }).click();
  await expect(page.getByText('Tên đơn vị đã tồn tại cho sản phẩm này.')).toBeVisible();
  await expect(editor).toBeVisible();
  expect(currentProduct.base_unit).toBe('Chiếc');
  expect(current.unit_name).toBe('Chiếc');

  await editor.getByRole('textbox', { name: 'Đơn vị', exact: true }).fill('Chiếc');
  await editor.getByRole('textbox', { name: 'Mã quét' }).fill('SW-SP013-BASE-NEW');
  await editor.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await page.getByRole('button', { name: 'Xác nhận thay đổi' }).click();
  await expect(page.getByRole('cell', { name: 'SW-SP013-BASE-NEW' })).toBeVisible();
  expect(current.unit_name).toBe('Chiếc');
  expect(patchCount).toBe(3);
});
