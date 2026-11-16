import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseUser, listDatabaseUsers, updateDatabaseUser } from '../../src/lib/users-api';
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
afterEach(() => { getSession.mockReset(); vi.unstubAllGlobals(); });

describe('database users client', () => {
  it('uses authorized GET with false status and combined filters', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'fixture-token' } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], count: 0 })));
    vi.stubGlobal('fetch', fetchMock);
    await listDatabaseUsers({ page: 2, limit: 10, q: 'staff', role: 'STAFF', isActive: false });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(new URL(url).pathname).toBe('/api/users');
    expect(Object.fromEntries(new URL(url).searchParams)).toEqual({ page: '2', limit: '10', q: 'staff', role: 'STAFF', isActive: 'false' });
    expect(options.headers.Authorization).toBe('Bearer fixture-token');
  });
  it('sends create and patch through backend without changing the admin auth session', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'fixture-token' } }, error: null });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: { user_id: '9007199254740993' } }))));
    vi.stubGlobal('fetch', fetchMock);
    const input = { username: 'staff', display_name: 'Staff', email: 'staff@example.test', password: 'qa-password-12345', role: 'STAFF' as const, is_active: true };
    await createDatabaseUser(input);
    await updateDatabaseUser('9007199254740993', { role: 'VIEWER', is_active: false });
    expect(fetchMock.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'PATCH']);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual(input);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ role: 'VIEWER', is_active: false });
  });
  it('propagates backend conflicts and missing configuration without fake success', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'fixture-token' } }, error: null });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Email đã được sử dụng.' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Chưa cấu hình dịch vụ quản trị tài khoản.' }), { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const input = { username: 'staff', display_name: 'Staff', email: 'staff@example.test', password: 'qa-password-12345', role: 'STAFF' as const, is_active: true };
    await expect(createDatabaseUser(input)).rejects.toMatchObject({ status: 409, code: 'USER_MANAGEMENT_ERROR' });
    await expect(createDatabaseUser(input)).rejects.toMatchObject({ status: 503, code: 'USER_MANAGEMENT_ERROR' });
  });
});
