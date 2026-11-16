import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
const url = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
const key = url && `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
const user = { user_id: '2', auth_user_id: '10000000-0000-4000-8000-000000000002', username: 'qa.staff', display_name: 'QA Staff', email: 'staff@example.test', role: 'STAFF', is_active: true, created_at: '2026-11-16T00:00:00Z', updated_at: '2026-11-16T00:00:00Z' };
const points = [{ scan_point_id: 'SCAN-01', point_name: 'Gate 1', is_active: true }, { scan_point_id: 'SCAN-02', point_name: 'Gate 2', is_active: true }, { scan_point_id: 'SCAN-03', point_name: 'Old Gate', is_active: false }];
const grant = (id: string, active = true) => ({ user_id: '2', scan_point_id: id, point_name: points.find(p => p.scan_point_id === id)!.point_name,
  is_active: active, scan_point_is_active: id !== 'SCAN-03', assigned_by: '1', assigned_at: '2026-11-16T00:00:00Z' });
async function setup(page: Page, initial = ['SCAN-01'], targetRole = 'ADMIN') {
  test.skip(!key, 'Supabase URL required for isolated browser session');
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' } })), { key: key! });
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user_id: '1', username: 'admin', display_name: 'QA Admin', role: 'ADMIN' } }));
  await page.route('**/api/scan-points', route => route.fulfill({ json: { data: points, count: points.length } }));
  const state = { grants: initial.map(id => grant(id)), puts: [] as string[][], patchCount: 0, getError: false, putError: false, patchError: false };
  await page.route('**/api/users**', async route => {
    const path = new URL(route.request().url()).pathname; const method = route.request().method();
    expect(route.request().headers().authorization).toBe('Bearer fixture-token');
    if (path.endsWith('/scan-points')) {
      if (method === 'PUT') {
        const body = route.request().postDataJSON(); expect(Object.keys(body)).toEqual(['scan_point_ids']); state.puts.push(body.scan_point_ids);
        if (state.putError) return route.fulfill({ status: 503, json: { message: 'Không lưu được quyền điểm quét.' } });
        const ids = body.scan_point_ids as string[];
        const all = new Set([...state.grants.map(g => g.scan_point_id), ...ids]);
        state.grants = [...all].map(id => grant(id, ids.includes(id)));
      } else if (state.getError) return route.fulfill({ status: 500, json: { message: 'unavailable' } });
      return route.fulfill({ json: { data: state.grants, count: state.grants.length } });
    }
    if (method === 'PATCH') { state.patchCount++; return route.fulfill(state.patchError ? { status: 409, json: { message: 'Tên đăng nhập đã được sử dụng.' } } : { json: { data: { ...user, ...route.request().postDataJSON() } } }); }
    return route.fulfill({ json: { data: [{ ...user, role: targetRole }], count: 1, pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } } });
  });
  await page.goto('/users'); return state;
}
async function edit(page: Page) { await page.getByRole('button', { name: 'Sửa người dùng', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('button', { name: 'Lưu người dùng' })).toBeEnabled(); return page.getByRole('dialog'); }
const checkbox = (page: Page, id: string) => page.getByRole('dialog').getByRole('checkbox', { name: new RegExp(`^${id} —`) });

test('loads saved grants, replaces them, reopens accurately and saves an unchanged selection without another PUT', async ({ page }) => {
  const state = await setup(page); let dialog = await edit(page);
  await expect(checkbox(page, 'SCAN-01')).toBeChecked(); await expect(checkbox(page, 'SCAN-02')).not.toBeChecked();
  await checkbox(page, 'SCAN-01').uncheck(); await checkbox(page, 'SCAN-02').check();
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).dblclick(); await expect(dialog).toBeHidden();
  expect(state.puts).toEqual([['SCAN-02']]); expect(state.patchCount).toBe(0);
  dialog = await edit(page); await expect(checkbox(page, 'SCAN-01')).not.toBeChecked(); await expect(checkbox(page, 'SCAN-02')).toBeChecked();
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).click(); await expect(dialog).toBeHidden(); expect(state.puts).toHaveLength(1);
});
test('grants both points, then revokes all with an empty array', async ({ page }) => {
  const state = await setup(page, []); let dialog = await edit(page);
  await checkbox(page, 'SCAN-01').check(); await checkbox(page, 'SCAN-02').check();
  await expect(checkbox(page, 'SCAN-03')).toBeDisabled();
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).click(); await expect(dialog).toBeHidden();
  expect(state.puts[0]).toEqual(['SCAN-01', 'SCAN-02']); dialog = await edit(page);
  await checkbox(page, 'SCAN-01').uncheck(); await checkbox(page, 'SCAN-02').uncheck();
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).click(); await expect(dialog).toBeHidden(); expect(state.puts[1]).toEqual([]);
  await edit(page); await expect(checkbox(page, 'SCAN-01')).not.toBeChecked(); await expect(checkbox(page, 'SCAN-02')).not.toBeChecked();
});
test('failed load blocks save and retry restores saved grants', async ({ page }) => {
  const state = await setup(page); state.getError = true;
  await page.getByRole('button', { name: 'Sửa người dùng' }).click(); const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.error-notice')).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Lưu người dùng' })).toBeDisabled();
  state.getError = false; await dialog.locator('.error-notice').getByRole('button', { name: 'Thử lại' }).click();
  await expect(checkbox(page, 'SCAN-01')).toBeChecked(); await expect(dialog.getByRole('button', { name: 'Lưu người dùng' })).toBeEnabled();
});
test('failed PUT retains selection, never patches the profile or reports success, and supports retry', async ({ page }) => {
  const state = await setup(page); const dialog = await edit(page); state.putError = true;
  await checkbox(page, 'SCAN-02').check(); await dialog.getByLabel('Tên hiển thị', { exact: true }).fill('Changed Name');
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).click(); await expect(page.getByText('Không lưu được quyền điểm quét.', { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible(); expect(state.patchCount).toBe(0); await expect(checkbox(page, 'SCAN-02')).toBeChecked();
  await expect(page.getByText('Đã cập nhật người dùng.', { exact: true })).toHaveCount(0);
  state.putError = false; await dialog.getByRole('button', { name: 'Lưu người dùng' }).click(); await expect(dialog).toBeHidden(); expect(state.patchCount).toBe(1);
});
test('a disabled point granted earlier can be unchecked but cannot be selected again', async ({ page }) => {
  await setup(page, ['SCAN-03']); await page.getByRole('button', { name: 'Sửa người dùng' }).click(); const dialog = page.getByRole('dialog');
  await expect(checkbox(page, 'SCAN-03')).toBeChecked(); await expect(dialog.getByRole('button', { name: 'Lưu người dùng' })).toBeDisabled();
  await checkbox(page, 'SCAN-03').uncheck(); await expect(checkbox(page, 'SCAN-03')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Lưu người dùng' })).toBeEnabled(); await dialog.getByRole('button', { name: 'Lưu người dùng' }).click(); await expect(dialog).toBeHidden();
});
test('reports partial result precisely if grants commit but profile editing fails', async ({ page }) => {
  const state = await setup(page); const dialog = await edit(page); state.patchError = true;
  await checkbox(page, 'SCAN-02').check(); await dialog.getByLabel('Tên hiển thị', { exact: true }).fill('Changed Name');
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).click();
  await expect(page.getByText(/Quyền điểm quét đã lưu; thông tin người dùng chưa lưu/)).toBeVisible(); await expect(dialog).toBeVisible();
  await expect(page.getByText('Đã cập nhật người dùng.', { exact: true })).toHaveCount(0); expect(state.puts).toHaveLength(1);
});
test('STAFF editor permits exactly one assigned point or none and repairs legacy multiple grants explicitly', async ({ page }) => {
  const state = await setup(page, ['SCAN-01', 'SCAN-02'], 'STAFF');
  await page.getByRole('button', { name: 'Sửa người dùng' }).click(); let dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Lưu người dùng' })).toBeDisabled();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('radio', { name: /^SCAN-02/ }).check();
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).click(); await expect(dialog).toBeHidden(); expect(state.puts[0]).toEqual(['SCAN-02']);
  dialog = await edit(page); await expect(dialog.getByRole('radio', { name: /^SCAN-02/ })).toBeChecked();
  await dialog.getByRole('radio', { name: 'Chưa phân công', exact: true }).check();
  await dialog.getByRole('button', { name: 'Lưu người dùng' }).click(); await expect(dialog).toBeHidden(); expect(state.puts[1]).toEqual([]);
});
