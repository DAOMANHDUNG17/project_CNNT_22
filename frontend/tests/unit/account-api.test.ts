import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountProfile, changeOwnPassword, newPasswordRules, resetAccountPassword } from '../../src/lib/account-api';
import { errorMessage } from '../../src/lib/format';
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
beforeEach(() => getSession.mockResolvedValue({ data: { session: { access_token: 'fixture-jwt' } }, error: null }));
afterEach(() => { vi.unstubAllGlobals(); getSession.mockReset(); });
const body = { new_password: 'synthetic-next', confirm_password: 'synthetic-next' };
describe('Account settings backend client', () => {
  it('reads own profile and sends password changes through authorized NestJS routes only', async () => {
    const transport = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')));
    vi.stubGlobal('fetch', transport);
    await accountProfile();
    await changeOwnPassword({ ...body, current_password: 'synthetic-current' });
    await resetAccountPassword('9007199254740993', body);
    expect(transport.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/api/account', '/api/account/password', '/api/users/9007199254740993/password']);
    expect(transport.mock.calls[1]![1].method).toBe('PATCH');
    expect(transport.mock.calls[2]![1].headers.Authorization).toBe('Bearer fixture-jwt');
    expect(JSON.parse(transport.mock.calls[2]![1].body)).toEqual(body);
  });
  it('fails without session before a network call', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    await expect(changeOwnPassword({ ...body, current_password: 'synthetic-current' })).rejects.toMatchObject({ status: 401 });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([400, 404, 429, 503])('shows sanitized backend Vietnamese error for status %i without retry', async status => {
    const transport = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Không thể hoàn tất yêu cầu mật khẩu.' }), { status }));
    vi.stubGlobal('fetch', transport);
    const error = await resetAccountPassword('2', body).catch(error => error);
    expect(errorMessage(error)).toBe('Không thể hoàn tất yêu cầu mật khẩu.'); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('supports DTO validation messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: ['Mật khẩu mới phải có 8–128 ký tự.'] }), { status: 400 })));
    const error = await changeOwnPassword({ ...body, current_password: 'synthetic-current' }).catch(error => error);
    expect(errorMessage(error)).toContain('8–128');
  });
  it.each(['', 'short', 'a'.repeat(129)])('rejects local password length case %#', async password => {
    await expect(newPasswordRules[1]!.validator!(null, password)).rejects.toThrow();
  });
  it('accepts minimum length locally and leaves provider-specific policy to server', async () => {
    await expect(newPasswordRules[1]!.validator!(null, 'a'.repeat(8))).resolves.toBeUndefined();
  });
});
