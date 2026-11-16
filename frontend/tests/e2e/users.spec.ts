import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const url = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
const key = url && `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
const admin = { user_id: '1', username: 'admin', display_name: 'QA Admin', role: 'ADMIN' };
const initial = { user_id: '9007199254740993', auth_user_id: '10000000-0000-4000-8000-000000000002', username: 'operator', display_name: 'QA Operator',
  email: 'operator@example.test', role: 'STAFF', is_active: true, created_at: '2026-11-16T00:00:00Z', updated_at: '2026-11-16T00:00:00Z' };
async function session(page: Page, role = 'ADMIN') {
  test.skip(!key, 'Supabase URL required for isolated browser session');
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } })), { key: key! });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { ...admin, role } }));
  await page.route('**/api/scan-points', route => route.fulfill({ json: { data: [], count: 0 } }));
}
async function form(page: Page) {
  await page.getByRole('button', { name: 'Thêm người dùng', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tên đăng nhập', { exact: true }).fill('staff.new');
  await dialog.getByLabel('Tên hiển thị', { exact: true }).fill('New Staff');
  await dialog.getByLabel('Email đăng nhập', { exact: true }).fill('new.staff@example.test');
  await dialog.getByLabel('Mật khẩu ban đầu', { exact: true }).fill('qa-password-12345');
  return dialog;
}

test('ADMIN reads database users, creates linked account, edits role, locks/unlocks and refreshes', async ({ page }) => {
  await session(page);
  let rows = [initial]; let gets = 0;
  const writes: { method: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/users**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/scan-points')) return route.fulfill({ json: { data: [], count: 0 } });
    expect(route.request().headers().authorization).toBe('Bearer fixture-token');
    const method = route.request().method();
    if (method !== 'GET') {
      const body = route.request().postDataJSON(); writes.push({ method, body });
      if (method === 'POST') { const { password: _password, ...data } = body; const user = { ...initial, ...data, user_id: '3', auth_user_id: '10000000-0000-4000-8000-000000000003' }; rows = [user]; return route.fulfill({ status: 201, json: { data: user } }); }
      rows = [{ ...rows[0]!, ...body }]; return route.fulfill({ json: { data: rows[0] } });
    }
    gets++; return route.fulfill({ json: { data: rows, count: rows.length, pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 } } });
  });
  await page.goto('/users');
  await expect(page.getByRole('menuitem', { name: /Quản lý người dùng/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Quản lý điểm quét/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'operator@example.test', exact: true })).toBeVisible();
  const dialog = await form(page);
  await expect(dialog.getByText('Thủ kho', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).dblclick();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({ method: 'POST', body: { username: 'staff.new', display_name: 'New Staff', email: 'new.staff@example.test', password: 'qa-password-12345', role: 'STAFF', is_active: true } });
  await expect(page.getByRole('cell', { name: 'new.staff@example.test', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menu tài khoản' })).toContainText('QA Admin');
  await page.getByRole('button', { name: 'Sửa người dùng' }).click();
  await expect(page.getByRole('dialog').getByLabel('Email đăng nhập', { exact: true })).toBeDisabled();
  await page.getByRole('dialog').getByLabel('Vai trò', { exact: true }).click();
  await page.getByTitle('Người xem', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu người dùng' }).click();
  await expect.poll(() => writes.length).toBe(2); expect(writes[1]!.body).toEqual({ role: 'VIEWER' });
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button', { name: 'Khóa', exact: true }).click();
  await page.getByRole('button', { name: 'Đồng ý', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mở khóa', exact: true })).toBeVisible();
  expect(writes[2]!.body).toEqual({ is_active: false });
  await page.getByRole('button', { name: 'Mở khóa', exact: true }).click();
  await page.getByRole('button', { name: 'Đồng ý', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Khóa', exact: true })).toBeVisible();
  const before = gets; await page.getByRole('button', { name: /Làm mới/ }).click();
  await expect.poll(() => gets).toBeGreaterThan(before);
});

for (const role of ['STAFF', 'VIEWER']) test(`${role} cannot see admin menus or open either admin URL`, async ({ page }) => {
  await session(page, role); let calls = 0;
  await page.route('**/api/users**', route => { calls++; return route.fulfill({ status: 403, json: {} }); });
  for (const path of ['/users', '/scan-points']) {
    await page.goto(path); await expect(page.getByText('Bạn chưa có quyền truy cập', { exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Quản lý người dùng|Quản lý điểm quét/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Thêm người dùng' })).toHaveCount(0);
  }
  expect(calls).toBe(0);
});

test('Users loading/error retry uses API and never displays mock accounts', async ({ page }) => {
  await session(page); let attempts = 0;
  await page.route('**/api/users**', async route => { attempts++; await new Promise(resolve => setTimeout(resolve, 500)); return route.fulfill({ status: attempts === 1 ? 500 : 200, json: attempts === 1 ? { message: 'unavailable' } : { data: [], count: 0, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } }); });
  await page.goto('/users');
  await expect(page.locator('.ant-spin-spinning')).toBeVisible();
  await expect(page.locator('.error-notice')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sửa người dùng' })).toHaveCount(0);
  await page.locator('.error-notice').getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.getByText('Chưa có dữ liệu phù hợp')).toBeVisible();
  await expect(page.locator('.error-notice')).toBeHidden();
});

for (const status of [409, 503]) test(`create ${status} retains form and never reports success`, async ({ page }) => {
  await session(page);
  await page.route('**/api/users**', route => route.fulfill(route.request().method() === 'POST' ? { status, json: { message: status === 409 ? 'Email đã được sử dụng.' : 'Chưa cấu hình dịch vụ quản trị tài khoản.' } } : { json: { data: [], count: 0, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } }));
  await page.goto('/users'); const dialog = await form(page);
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).click();
  await expect(page.getByText(status === 409 ? 'Email đã được sử dụng.' : 'Chưa cấu hình dịch vụ quản trị tài khoản.', { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible(); await expect(dialog.getByLabel('Email đăng nhập', { exact: true })).toHaveValue('new.staff@example.test');
  await expect(page.getByText('Đã tạo người dùng.', { exact: true })).toHaveCount(0);
});

test('validates required fields and sends combined search filters to backend', async ({ page }) => {
  await session(page); const queries: URLSearchParams[] = []; let writes = 0;
  await page.route('**/api/users**', route => {
    if (route.request().method() !== 'GET') writes++;
    queries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: { data: [], count: 0, pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } } });
  });
  await page.goto('/users');
  await page.getByRole('textbox', { name: 'Tìm người dùng' }).fill('staff@example.test');
  await page.getByRole('combobox', { name: 'Lọc vai trò' }).click();
  await page.getByTitle('Nhân viên', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Lọc trạng thái' }).click();
  await page.getByTitle('Đã khóa', { exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get('isActive')).toBe('false');
  expect(Object.fromEntries(queries.at(-1)!)).toMatchObject({ q: 'staff@example.test', role: 'STAFF', isActive: 'false', page: '1' });
  await page.getByRole('button', { name: 'Thêm người dùng', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Lưu người dùng' }).click();
  await expect(page.locator('.ant-form-item-explain-error').first()).toBeVisible(); expect(writes).toBe(0);
});

test('last ADMIN rejection retains edited form without false success', async ({ page }) => {
  await session(page);
  await page.route('**/api/users**', route => route.fulfill(new URL(route.request().url()).pathname.endsWith('/scan-points') ? { json: { data: [], count: 0 } } : route.request().method() === 'PATCH'
    ? { status: 409, json: { message: 'Phải giữ ít nhất một ADMIN hoạt động.' } }
    : { json: { data: [{ ...initial, user_id: '1', role: 'ADMIN' }], count: 1, pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } } }));
  await page.goto('/users'); await page.getByRole('button', { name: 'Sửa người dùng' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Vai trò', { exact: true }).click(); await page.getByTitle('Người xem', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).click();
  await expect(page.getByText('Phải giữ ít nhất một ADMIN hoạt động.', { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible(); await expect(page.getByText('Đã cập nhật người dùng.', { exact: true })).toHaveCount(0);
});
