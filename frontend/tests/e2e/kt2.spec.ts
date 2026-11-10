import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const id = 'f3a754fd-df1d-4d7f-8220-411f07415070';
const row = {
  transaction_id: id, product_id: 'SP013', product_name: 'Bút mực', product_unit_id: '30',
  unit_name: 'Hộp nhỏ', movement_type: 'IN', quantity_packages: 1, conversion_factor_snapshot: 24,
  quantity_base: '24', inventory_before: '24', inventory_after: '48',
  scan_code_snapshot: 'SW-SP013-BOX24', scan_point_id: 'SCAN-01', point_name: 'Cửa A',
  user_id: '1', display_name: 'ADMIN', created_at: '2026-11-09T22:03:59Z',
};

async function setup(page: import('@playwright/test').Page, role = 'ADMIN') {
  test.skip(!storageKey, 'Supabase URL required for local browser fixture');
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({
    access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer',
    expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
      email: 'qa@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  })), { key: storageKey! });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user_id: '1', username: 'qa', display_name: 'QA', role } }));
  await page.route('**/api/products', route => route.fulfill({ json: { data: [{ product_id: 'SP013', product_name: 'Bút mực', base_unit: 'Chiếc', is_active: true }], count: 1 } }));
  await page.route('**/api/product-units', route => route.fulfill({ json: { data: [{ product_unit_id: '30', product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp nhỏ', conversion_factor: 24, scan_code: 'SW-SP013-BOX24', is_base_unit: false }], count: 1 } }));
  await page.route('**/api/scan-points', route => route.fulfill({ json: { data: [{ scan_point_id: 'SCAN-01', point_name: 'Cửa A', is_active: true }], count: 1 } }));
  let stock = '48'; let inventoryReads = 0; let productTotal = 2; let exactTotal = 1;
  let currentRow = { ...row };
  await page.route('**/api/inventory', route => {
    inventoryReads++;
    return route.fulfill({ json: { data: [{ product_id: 'SP013', product_name: 'Bút mực', base_unit: 'Chiếc', is_active: true, quantity_base: stock }], count: 1 } });
  });
  await page.route('**/api/transactions**', route => {
    const query = new URL(route.request().url()).searchParams;
    const exact = query.has('transactionId');
    return route.fulfill({ json: { data: exact && exactTotal === 0 ? [] : [currentRow], count: exact ? exactTotal : productTotal,
      pagination: { page: 1, limit: 1, total: exact ? exactTotal : productTotal, totalPages: exact ? exactTotal : productTotal } } });
  });
  return { setStock: (value: string) => { stock = value; }, setTotal: (value: number) => { productTotal = value; },
    setExact: (value: number) => { exactTotal = value; }, setRow: (value: typeof row) => { currentRow = value; },
    inventoryReads: () => inventoryReads };
}

async function findOriginal(page: import('@playwright/test').Page) {
  await page.goto('/stock-movement');
  await page.getByRole('tab', { name: 'Kiểm tra KT2' }).click();
  await page.getByRole('textbox', { name: 'UUID giao dịch KT2' }).fill(id);
  await page.getByRole('button', { name: 'Tra cứu giao dịch' }).click();
  await expect(page.getByRole('button', { name: 'Thực hiện kiểm thử KT2' })).toBeEnabled();
}

test('ADMIN uses saved snapshot and one bearer POST; unchanged GET evidence yields PASS', async ({ page }) => {
  const db = await setup(page);
  let posts = 0;
  await page.route('**/api/stock-movements', route => {
    posts++;
    expect(route.request().headers().authorization).toBe('Bearer fixture-token');
    expect(route.request().postDataJSON()).toEqual({ transaction_id: id, scan_code: 'SW-SP013-BOX24', scan_point_id: 'SCAN-01', movement_type: 'IN' });
    return route.fulfill({ status: 200, json: { data: { transaction_id: id } } });
  });
  await findOriginal(page);
  await expect(page.getByText('Tồn trước giao dịch gốc')).toBeVisible();
  await expect(page.getByText('Tồn kho hiện tại trước retry')).toBeVisible();
  expect(posts).toBe(0);
  await page.getByRole('button', { name: 'Thực hiện kiểm thử KT2' }).click();
  await expect(page.getByRole('dialog', { name: 'Xác nhận kiểm thử KT2' })).toBeVisible();
  expect(posts).toBe(0);
  await page.getByRole('button', { name: 'Gửi lại giao dịch gốc' }).evaluate(element => {
    const button = element as HTMLButtonElement;
    button.click(); button.click();
  });
  await expect(page.getByText('KT2: PASS')).toBeVisible();
  await expect(page.getByText('Retry trả về giao dịch gốc')).toBeVisible();
  expect(posts).toBe(1);
  expect(db.inventoryReads()).toBeGreaterThanOrEqual(2);
});

test('invalid and missing UUID never POST, and OUT placeholder has no action', async ({ page }) => {
  const db = await setup(page);
  let posts = 0;
  page.on('request', request => { if (request.url().includes('/api/stock-movements')) posts++; });
  await page.goto('/stock-movement');
  await page.getByRole('tab', { name: 'Xuất kho' }).click();
  await expect(page.getByText('Chức năng xuất kho đang được phát triển.')).toBeVisible();
  await page.getByRole('tab', { name: 'Kiểm tra KT2' }).click();
  await page.getByRole('textbox', { name: 'UUID giao dịch KT2' }).fill('invalid');
  await expect(page.getByRole('button', { name: 'Tra cứu giao dịch' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'UUID giao dịch KT2' }).fill(id);
  db.setExact(0);
  await page.getByRole('button', { name: 'Tra cứu giao dịch' }).click();
  await expect(page.getByText('Không tìm thấy giao dịch đã hoàn thành.')).toBeVisible();
  expect(posts).toBe(0);
});

for (const variant of ['OUT', 'foreign']) {
  test(`${variant} original transaction cannot be retried`, async ({ page }) => {
    const db = await setup(page);
    db.setRow(variant === 'OUT' ? { ...row, movement_type: 'OUT' } : { ...row, user_id: '2' });
    let posts = 0;
    page.on('request', request => { if (request.url().includes('/api/stock-movements')) posts++; });
    await page.goto('/stock-movement');
    await page.getByRole('tab', { name: 'Kiểm tra KT2' }).click();
    await page.getByRole('textbox', { name: 'UUID giao dịch KT2' }).fill(id);
    await page.getByRole('button', { name: 'Tra cứu giao dịch' }).click();
    await expect(page.getByText(variant === 'OUT' ? 'Chỉ giao dịch IN được kiểm tra bằng API hiện tại.'
      : 'Giao dịch này do tài khoản khác thực hiện. Hãy đăng nhập đúng tài khoản gốc để kiểm tra KT2.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thực hiện kiểm thử KT2' })).toHaveCount(0);
    expect(posts).toBe(0);
  });
}

for (const role of ['STAFF', 'VIEWER']) {
  test(`${role} has no KT2 tab`, async ({ page }) => {
    await setup(page, role);
    await page.goto('/stock-movement');
    await expect(page.getByRole('tab', { name: 'Kiểm tra KT2' })).toHaveCount(0);
    if (role === 'VIEWER') await expect(page.getByRole('button', { name: 'Xác nhận nhập kho' })).toHaveCount(0);
  });
}

for (const status of [409, 401, 403, 500]) {
  test(`HTTP ${status} cannot claim KT2 PASS`, async ({ page }) => {
    await setup(page);
    await page.route('**/api/stock-movements', route => route.fulfill({ status, json: { message: status === 409 ? 'Mã giao dịch đã được dùng cho nội dung khác.' : 'Rejected' } }));
    await findOriginal(page);
    await page.getByRole('button', { name: 'Thực hiện kiểm thử KT2' }).click();
    await page.getByRole('button', { name: 'Gửi lại giao dịch gốc' }).click();
    await expect(page.getByText('KT2: PASS')).toHaveCount(0);
    await expect(page.getByText(`KT2: ${status === 500 ? 'CHƯA ĐỦ BẰNG CHỨNG' : 'FAIL'}`)).toBeVisible();
  });
}

test('POST timeout keeps original UUID and reports insufficient evidence', async ({ page }) => {
  await setup(page);
  let sent: unknown;
  await page.route('**/api/stock-movements', route => { sent = route.request().postDataJSON(); return route.abort('timedout'); });
  await findOriginal(page);
  await page.getByRole('button', { name: 'Thực hiện kiểm thử KT2' }).click();
  await page.getByRole('button', { name: 'Gửi lại giao dịch gốc' }).click();
  await expect(page.getByText('KT2: CHƯA ĐỦ BẰNG CHỨNG')).toBeVisible();
  expect(sent).toEqual({ transaction_id: id, scan_code: 'SW-SP013-BOX24', scan_point_id: 'SCAN-01', movement_type: 'IN' });
});

test('failed after-state GET never claims PASS', async ({ page }) => {
  await setup(page);
  let postHappened = false;
  await page.route('**/api/inventory', route => postHappened ? route.fulfill({ status: 500, json: { message: 'Unavailable' } }) : route.fallback());
  await page.route('**/api/stock-movements', route => {
    postHappened = true;
    return route.fulfill({ status: 200, json: { data: { transaction_id: id } } });
  });
  await findOriginal(page);
  await page.getByRole('button', { name: 'Thực hiện kiểm thử KT2' }).click();
  await page.getByRole('button', { name: 'Gửi lại giao dịch gốc' }).click();
  await expect(page.getByText('KT2: CHƯA ĐỦ BẰNG CHỨNG')).toBeVisible();
});

test('network ambiguity and concurrent stock changes stay inconclusive; UUID edit clears evidence', async ({ page }) => {
  const db = await setup(page);
  await page.route('**/api/stock-movements', route => { db.setStock('72'); db.setTotal(3); return route.fulfill({ status: 200, json: { data: { transaction_id: id } } }); });
  await findOriginal(page);
  await page.getByRole('button', { name: 'Thực hiện kiểm thử KT2' }).click();
  await page.getByRole('button', { name: 'Gửi lại giao dịch gốc' }).click();
  await expect(page.getByText('CHƯA THỂ KẾT LUẬN DO CÓ HOẠT ĐỘNG ĐỒNG THỜI').first()).toBeVisible();
  await page.getByRole('textbox', { name: 'UUID giao dịch KT2' }).fill('550e8400-e29b-41d4-a716-446655440000');
  await expect(page.getByText('Kết quả đối chiếu')).toHaveCount(0);
});

test('switching tabs preserves a pending IN UUID', async ({ page }) => {
  await setup(page);
  const bodies: unknown[] = [];
  await page.route('**/api/stock-movements', route => { bodies.push(route.request().postDataJSON()); return route.abort('timedout'); });
  await page.goto('/stock-movement');
  await page.getByRole('combobox', { name: 'Điểm quét' }).click();
  await page.getByText('SCAN-01 — Cửa A').last().click();
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('SW-SP013-BOX24');
  await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
  await expect(page.getByText('Lượt nhập đang được giữ để thử lại')).toBeVisible();
  await page.getByRole('tab', { name: 'Xuất kho' }).click();
  await page.getByRole('tab', { name: 'Nhập kho' }).click();
  await expect(page.getByRole('button', { name: 'Thử lại lượt nhập' })).toBeVisible();
  await page.getByRole('button', { name: 'Thử lại lượt nhập' }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toEqual(bodies[0]);
});
