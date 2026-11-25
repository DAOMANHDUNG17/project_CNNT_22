import { ConfigService } from '@nestjs/config';
import { SupabaseAdminService } from '../users/supabase-admin.service';

describe('Password official Auth HTTP transport (fetch doubles only)', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  const other = '10000000-0000-4000-8000-000000000002';
  const service = new SupabaseAdminService(new ConfigService({ SUPABASE_URL: 'https://auth.example.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-server-key' }));
  const original = global.fetch;
  const transport = jest.fn();
  const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });
  const identity = () => transport.mockResolvedValueOnce(json({ id, email: 'synthetic@example.test', user_metadata: { private: 'omit' } }));
  const session = () => transport.mockResolvedValueOnce(json({ access_token: 'fixture-reauth', refresh_token: 'fixture-transient', user: { id } }));
  beforeEach(() => { global.fetch = transport; transport.mockReset(); });
  afterAll(() => { global.fetch = original; });
  it('projects own email only and rejects mismatched identities', async () => {
    identity(); await expect(service.passwordIdentity('fixture-jwt', id)).resolves.toEqual({ email: 'synthetic@example.test' });
    transport.mockResolvedValueOnce(json({ id: other, email: 'other@example.test' }));
    await expect(service.passwordIdentity('fixture-jwt', id)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects wrong current password before any password update', async () => {
    identity(); transport.mockResolvedValueOnce(json({ error_code: 'invalid_credentials', message: 'never relay provider content' }, 400));
    await expect(service.changeOwnPassword('fixture-jwt', id, 'fixture-current', 'fixture-next')).rejects.toMatchObject({ status: 400 });
    expect(transport.mock.calls.some(([, options]) => options.method === 'PUT')).toBe(false);
  });
  it('reauthenticates on server, binds UUID, updates own password and requests global logout', async () => {
    identity(); session(); transport.mockResolvedValueOnce(json({ id })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(service.changeOwnPassword('fixture-jwt', id, 'fixture-current', 'fixture-next')).resolves.toEqual({ refresh_sessions_revoked: true });
    expect(transport.mock.calls.map(([url]) => new URL(url).pathname + new URL(url).search)).toEqual([
      '/auth/v1/user', '/auth/v1/token?grant_type=password', '/auth/v1/user', '/auth/v1/logout?scope=global',
    ]);
    expect(JSON.parse(transport.mock.calls[1][1].body)).toEqual({ email: 'synthetic@example.test', password: 'fixture-current' });
    expect(transport.mock.calls[2][1]).toMatchObject({ method: 'PUT', headers: { Authorization: 'Bearer fixture-reauth' } });
    expect(JSON.parse(transport.mock.calls[2][1].body)).toEqual({ password: 'fixture-next', current_password: 'fixture-current' });
  });
  it('cleans temporary session and does not update if reauthentication UUID differs', async () => {
    identity(); transport.mockResolvedValueOnce(json({ access_token: 'fixture-reauth', user: { id: other } })).mockResolvedValueOnce(json({}));
    await expect(service.changeOwnPassword('fixture-jwt', id, 'fixture-current', 'fixture-next')).rejects.toMatchObject({ status: 403 });
    expect(transport.mock.calls.some(([, options]) => options.method === 'PUT')).toBe(false);
    expect(transport.mock.calls[2][0]).toContain('/logout?scope=local');
  });
  it.each(['weak_password', 'same_password', 'reauthentication_needed'])('handles provider policy case %s and cleans temporary session', async code => {
    identity(); session(); transport.mockResolvedValueOnce(json({ code, message: 'fixture-private' }, 422)).mockResolvedValueOnce(json({}));
    await expect(service.changeOwnPassword('fixture-jwt', id, 'fixture-current', 'fixture-next')).rejects.toMatchObject({ status: 400 });
    expect(transport.mock.calls.at(-1)![0]).toContain('/logout?scope=local');
  });
  it('keeps password success when global logout cannot be confirmed', async () => {
    identity(); session(); transport.mockResolvedValueOnce(json({ id })).mockRejectedValueOnce(new Error('fixture-private'));
    await expect(service.changeOwnPassword('fixture-jwt', id, 'fixture-current', 'fixture-next')).resolves.toEqual({ refresh_sessions_revoked: false });
  });
  it('updates only password of the bound Admin Auth UUID, no session/metadata operations', async () => {
    transport.mockResolvedValueOnce(json({ id: other, email: 'omit@example.test' }));
    await expect(service.resetPassword(other, 'fixture-next')).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe(`https://auth.example.test/auth/v1/admin/users/${other}`);
    expect(JSON.parse(transport.mock.calls[0][1].body)).toEqual({ password: 'fixture-next' });
  });
  it.each([['weak_password', 422, 400], ['user_not_found', 404, 404], ['over_request_rate_limit', 429, 429], ['unexpected', 500, 503]])('sanitizes Admin provider failure case %#', async (code, status, expected) => {
    transport.mockResolvedValueOnce(json({ code, message: 'fixture-private' }, status as number));
    const error = await service.resetPassword(other, 'fixture-next').catch(error => error);
    expect(error.status).toBe(expected); expect(JSON.stringify(error)).not.toContain('fixture-private');
  });
  it('does not retry an ambiguous update or relay its credentials', async () => {
    transport.mockRejectedValueOnce(new Error('fixture-private'));
    const error = await service.resetPassword(other, 'fixture-next').catch(error => error);
    expect(error.status).toBe(503); expect(JSON.stringify(error)).not.toContain('fixture-private');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed success rather than reporting an unconfirmed password update', async () => {
    transport.mockResolvedValueOnce(json({ id }));
    await expect(service.resetPassword(other, 'fixture-next')).rejects.toMatchObject({ status: 503 });
  });
});
