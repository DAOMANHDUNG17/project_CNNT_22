import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const envFile = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const supabaseUrl = /^VITE_SUPABASE_URL=(.+)$/m.exec(envFile)?.[1]?.trim();
const storageKey = supabaseUrl && `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

async function preparePoint(page: import('@playwright/test').Page) {
  await expect(page.getByRole('textbox', { name: 'Mã quét', exact: true })).toBeVisible();
  const select = page.getByRole('combobox', { name: 'Điểm quét', exact: true });
  if (await select.count()) { await select.click(); await page.getByTitle('SCAN-01 — Cửa A', { exact: true }).click(); }
  else await expect(page.getByRole('textbox', { name: 'Điểm quét được phân công' })).toHaveValue(/SCAN-01/);
}

async function setup(page: import('@playwright/test').Page, role: 'ADMIN' | 'STAFF' | 'VIEWER' = 'STAFF') {
  test.skip(!storageKey, 'Supabase URL is needed for the local test session');
  await page.addInitScript(() => { Object.defineProperty(Crypto.prototype, 'randomUUID', { configurable: true, value: undefined }); });
  await page.addInitScript(({ key }) => {
    localStorage.setItem(key, JSON.stringify({
      access_token: 'local-e2e-access-token', refresh_token: 'local-e2e-refresh-token', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
        email: 'staff@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00.000Z' },
    }));
  }, { key: storageKey! });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user_id: '42', username: 'staff', display_name: 'Staff', role } }));
  await page.route('**/api/products', route => route.fulfill({ json: { data: [{ product_id: 'SP013', product_name: 'Bút mực', base_unit: 'chiếc', is_active: true }], count: 1 } }));
  await page.route('**/api/product-units', route => route.fulfill({ json: { data: [{ product_unit_id: '29', product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', conversion_factor: 24, scan_code: 'BOX-ABC', is_base_unit: false }], count: 1 } }));
  let inventory = '100';
  let inventoryReads = 0;
  await page.route('**/api/inventory', route => { inventoryReads++; return route.fulfill({ json: { data: [{ product_id: 'SP013', product_name: 'Bút mực', base_unit: 'chiếc', is_active: true, quantity_base: inventory }], count: 1 } }); });
  let assigned = ['SCAN-01'];
  let assignmentReads = 0;
  await page.route('**/api/scan-points/my', route => { assignmentReads++; return route.fulfill({ json: { data: assigned.map(id => ({ scan_point_id: id, point_name: id === 'SCAN-01' ? 'Cửa A' : 'Cửa B', is_active: true })), count: assigned.length } }); });
  return { setInventory: (value: string) => { inventory = value; }, inventoryReads: () => inventoryReads, setAssignment: (ids: string[]) => { assigned = ids; }, assignmentReads: () => assignmentReads };
}

test('scan preview needs explicit confirmation, then bearer POST refreshes real inventory', async ({ page }) => {
  const db = await setup(page);
  let calls = 0;
  const transactionIds: string[] = [];
  await page.route('**/api/stock-movements', async route => {
    calls++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers().authorization).toBe('Bearer local-e2e-access-token');
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({ scan_code: 'BOX-ABC', scan_point_id: 'SCAN-01', movement_type: 'IN', quantity_packages: 1 });
    expect(body.transaction_id).toMatch(/^[0-9a-f-]{36}$/);
    transactionIds.push(body.transaction_id);
    expect(Object.keys(body).sort()).toEqual(['movement_type', 'quantity_packages', 'scan_code', 'scan_point_id', 'transaction_id']);
    db.setInventory('124');
    await route.fulfill({ status: 201, json: { data: { ...body, product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', quantity_base: '24', inventory_before: '100', inventory_after: '124' } } });
  });
  await page.goto('/stock-movement');
  await expect(page.getByText('Quét hoặc nhập mã')).toBeVisible();
  await preparePoint(page);
  await expect(page.getByText('SCAN-02 — Cửa B')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('BOX-ABC');
  await page.getByRole('textbox', { name: 'Mã quét' }).press('Enter');
  await expect(page.getByText('1 Hộp = 24 chiếc')).toBeVisible();
  expect(calls).toBe(0);
  const confirm = page.getByRole('button', { name: 'Xác nhận nhập kho' });
  await confirm.dblclick();
  await expect(page.getByText('Đã nhập kho', { exact: true })).toBeVisible();
  await expect(page.getByText('124', { exact: true }).first()).toBeVisible();
  expect(calls).toBe(1);
  await expect.poll(() => db.inventoryReads()).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole('button', { name: 'Xác nhận nhập kho' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Lượt nhập tiếp theo' }).click();
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('BOX-ABC');
  await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
  await expect(page.getByText('Đã nhập kho', { exact: true })).toBeVisible();
  expect(calls).toBe(2);
  expect(transactionIds[1]).not.toBe(transactionIds[0]);
});

test('editable IN count previews and submits three packages using the database factor', async ({ page }) => {
  await setup(page);
  const bodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/stock-movements', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    return route.fulfill({ status: 201, json: { data: { ...body, product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', quantity_base: '72', inventory_before: '100', inventory_after: '172' } } });
  });
  await page.goto('/stock-movement');
  await preparePoint(page);
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('BOX-ABC');
  await page.getByRole('spinbutton', { name: 'Số đơn vị đóng gói nhập' }).fill('3');
  await expect(page.getByText('72 chiếc', { exact: true })).toBeVisible();
  await expect(page.getByText('172 chiếc')).toBeVisible();
  expect(bodies).toHaveLength(0);
  await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
  await expect(page.getByText('Đã nhập kho', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ movement_type: 'IN', quantity_packages: 3 });
});

test('STAFF sees the backend assignment as locked text and cannot select a forged local station', async ({ page }) => {
  await setup(page); await page.addInitScript(() => { localStorage.setItem('station', 'SCAN-02'); sessionStorage.setItem('scan_point_id', 'SCAN-02'); });
  await page.goto('/stock-movement');
  await expect(page.getByRole('textbox', { name: 'Điểm quét được phân công' })).toHaveValue('SCAN-01 — Cửa A');
  await expect(page.getByRole('textbox', { name: 'Điểm quét được phân công' })).toHaveAttribute('readonly', '');
  await expect(page.getByRole('combobox', { name: 'Điểm quét', exact: true })).toHaveCount(0);
  await expect(page.locator('.station-status')).toContainText('SCAN-01');
});

test('header and IN/OUT share one permission request and update together on reassignment/revocation', async ({ page }) => {
  const db = await setup(page); await page.goto('/stock-movement');
  await expect(page.locator('.station-status')).toContainText('SCAN-01'); expect(db.assignmentReads()).toBe(1);
  db.setAssignment(['SCAN-02']); await page.getByRole('button', { name: /Làm mới/ }).click();
  await expect(page.locator('.station-status')).toContainText('SCAN-02');
  await expect(page.getByRole('textbox', { name: 'Điểm quét được phân công' })).toHaveValue('SCAN-02 — Cửa B'); expect(db.assignmentReads()).toBe(2);
  await page.getByRole('tab', { name: 'Xuất kho' }).click();
  await expect(page.getByRole('textbox', { name: 'Điểm quét được phân công' })).toHaveValue('SCAN-02 — Cửa B'); expect(db.assignmentReads()).toBe(2);
  db.setAssignment([]); await page.getByRole('button', { name: /Làm mới/ }).click();
  await expect(page.locator('.station-status')).toContainText('Chưa gán điểm quét');
  await expect(page.getByRole('textbox', { name: 'Điểm quét được phân công' })).toHaveValue('Chưa có phân công hợp lệ');
  await expect(page.getByRole('button', { name: 'Xác nhận xuất kho' })).toBeDisabled(); expect(db.assignmentReads()).toBe(3);
});

for (const assigned of [[], ['SCAN-01', 'SCAN-02']]) test(`STAFF invalid assignment ${assigned.length} disables stock confirmation`, async ({ page }) => {
  const db = await setup(page); db.setAssignment(assigned); let writes = 0;
  await page.route('**/api/stock-movements', route => { writes++; return route.fulfill({ status: 403, json: {} }); });
  await page.goto('/stock-movement'); await page.getByRole('textbox', { name: 'Mã quét', exact: true }).fill('BOX-ABC');
  await expect(page.getByRole('button', { name: 'Xác nhận nhập kho' })).toBeDisabled(); expect(writes).toBe(0);
});

test('assignment change 403 refreshes locked context, preserves pending UUID/point and uses a new UUID only after explicit discard', async ({ page }) => {
  const db = await setup(page); const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/stock-movements', route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    if (bodies.length === 1) { db.setAssignment(['SCAN-02']); return route.fulfill({ status: 403, json: { message: 'Điểm quét không thuộc phân công hiện tại của tài khoản.' } }); }
    return route.fulfill({ status: 201, json: { data: { ...body, product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', quantity_base: '24', inventory_before: '100', inventory_after: '124' } } });
  });
  await page.goto('/stock-movement'); await page.getByRole('textbox', { name: 'Mã quét', exact: true }).fill('BOX-ABC');
  await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
  await expect(page.getByText('Điểm quét không thuộc phân công hiện tại của tài khoản.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Điểm quét được phân công' })).toHaveValue('SCAN-02 — Cửa B');
  await expect(page.locator('.station-status')).toContainText('SCAN-02');
  await expect(page.getByRole('button', { name: 'Thử lại lượt nhập' })).toBeDisabled();
  const pending = await page.evaluate(() => JSON.parse(sessionStorage.getItem('warehouse:pending-stock-in:42') || 'null'));
  expect(pending.payload).toEqual(bodies[0]); expect(pending.payload.scan_point_id).toBe('SCAN-01');
  await expect(page.getByText('Đã nhập kho', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Bỏ lượt bị từ chối' }).click();
  await page.getByRole('textbox', { name: 'Mã quét', exact: true }).fill('BOX-ABC'); await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
  await expect(page.getByText('Đã nhập kho', { exact: true })).toBeVisible();
  expect(bodies[1]!.scan_point_id).toBe('SCAN-02'); expect(bodies[1]!.transaction_id).not.toBe(bodies[0]!.transaction_id);
});

test('KT2 retry after a committed IN response is lost keeps one movement across reload', async ({ page }) => {
  const db = await setup(page);
  const requests: Array<Record<string, unknown>> = [];
  const committed = new Map<string, { data: Record<string, unknown> }>();
  await page.route('**/api/stock-movements', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    const id = String(body.transaction_id);
    const fresh = !committed.has(id);
    if (fresh) {
      const before = 100 + committed.size * 24;
      committed.set(id, { data: { ...body, product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp',
        quantity_packages: 1, conversion_factor_snapshot: 24, quantity_base: '24',
        inventory_before: String(before), inventory_after: String(before + 24) } });
      db.setInventory(String(before + 24));
    }
    // The fake server commits before deliberately losing the first response.
    if (requests.length === 1) return route.abort('timedout');
    return route.fulfill({ status: fresh ? 201 : 200, json: committed.get(id) });
  });
  await page.goto('/stock-movement');
  await preparePoint(page);
  await page.getByRole('textbox', { name: 'Mã quét', exact: true }).fill('BOX-ABC');
  await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
  await expect(page.getByText('Lượt nhập đang được giữ để thử lại')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Thử lại lượt nhập' }).click();
  await expect(page.getByText('Đã nhập kho', { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(committed.size).toBe(1);
  await expect(page.getByText('124', { exact: true }).first()).toBeVisible();
});

test('network failure preserves UUID and freezes inputs for an exact retry', async ({ page }) => {
  await setup(page);
  const bodies: Array<Record<string, string>> = [];
  await page.route('**/api/stock-movements', async route => {
    const body = route.request().postDataJSON() as Record<string, string>;
    bodies.push(body);
    if (bodies.length === 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.abort('timedout');
      return;
    }
    await route.fulfill({ status: 200, json: { data: { ...body, product_id: 'SP013', product_name: 'Bút mực', unit_name: 'Hộp', quantity_base: '72', inventory_before: '100', inventory_after: '172' } } });
  });
  await page.goto('/stock-movement');
  await preparePoint(page);
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('BOX-ABC');
  await page.getByRole('spinbutton', { name: 'Số đơn vị đóng gói nhập' }).fill('3');
  await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
  await expect(page.getByText('Lượt nhập đang được giữ để thử lại')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Mã quét' })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Thử lại lượt nhập' })).toBeVisible();
  await page.getByRole('button', { name: 'Thử lại lượt nhập' }).click();
  await expect(page.getByText('Đã nhập kho', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]?.quantity_packages).toBe(3);
});

test('VIEWER cannot access stock movement action', async ({ page }) => {
  await setup(page, 'VIEWER');
  await page.goto('/stock-movement');
  await expect(page.getByRole('button', { name: 'Xác nhận nhập kho' })).toHaveCount(0);
});

test('business conflict keeps the request and shows the backend message without fake success', async ({ page }) => {
  await setup(page, 'ADMIN');
  await page.route('**/api/stock-movements', route => route.fulfill({ status: 409, json: { message: 'Điểm quét đã ngừng hoạt động.' } }));
  await page.goto('/stock-movement');
  await preparePoint(page);
  await page.getByRole('textbox', { name: 'Mã quét' }).fill('BOX-ABC');
  await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
  await expect(page.getByText('Điểm quét đã ngừng hoạt động.')).toBeVisible();
  await expect(page.getByText('Đã nhập kho', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Thử lại lượt nhập' })).toBeVisible();
});

for (const errorCase of [
  { status: 400, message: 'Dữ liệu chưa hợp lệ. Kiểm tra các trường trong biểu mẫu.' },
  { status: 401, message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' },
  { status: 403, message: 'Tài khoản không có quyền thực hiện thao tác này.' },
  { status: 404, message: 'Không tìm thấy mã quét.' },
]) {
  test(`HTTP ${errorCase.status} is shown without fake success`, async ({ page }) => {
    await setup(page, 'ADMIN');
    await page.route('**/api/stock-movements', route => route.fulfill({
      status: errorCase.status,
      json: { message: errorCase.status === 404 ? errorCase.message : 'Rejected' },
    }));
    await page.goto('/stock-movement');
    await preparePoint(page);
    await page.getByRole('textbox', { name: 'Mã quét' }).fill('BOX-ABC');
    await page.getByRole('button', { name: 'Xác nhận nhập kho' }).click();
    await expect(page.getByText(errorCase.message)).toBeVisible();
    await expect(page.getByText('Đã nhập kho', { exact: true })).toHaveCount(0);
  });
}
