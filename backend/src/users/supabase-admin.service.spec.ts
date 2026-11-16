import { ConfigService } from '@nestjs/config';
import { SupabaseAdminService } from './supabase-admin.service';

describe('Supabase Admin transport', () => {
  const id = '10000000-0000-4000-8000-000000000001';
  const service = new SupabaseAdminService(new ConfigService({ SUPABASE_URL: 'https://qa.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' }));
  const original = global.fetch;
  const fetchMock = jest.fn();
  beforeEach(() => { global.fetch = fetchMock; fetchMock.mockReset(); });
  afterAll(() => { global.fetch = original; });

  it('fails closed without server key before any request', async () => {
    await expect(new SupabaseAdminService(new ConfigService({ SUPABASE_URL: 'https://qa.supabase.co' })).create('qa@example.test', 'long-password')).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses only backend Admin API and confirms email without modifying any session', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id, email: 'qa@example.test' })));
    await expect(service.create('qa@example.test', 'long-password')).resolves.toBe(id);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://qa.supabase.co/auth/v1/admin/users');
    expect(options.headers).toMatchObject({ apikey: 'server-secret', Authorization: 'Bearer server-secret' });
    expect(JSON.parse(options.body)).toEqual({ email: 'qa@example.test', password: 'long-password', email_confirm: true });
  });
  it('maps duplicate email and hides upstream secrets', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'email_exists' }), { status: 422 }));
    await expect(service.create('qa@example.test', 'long-password')).rejects.toMatchObject({ status: 409 });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'server-secret password' }), { status: 500 }));
    await expect(service.create('qa@example.test', 'long-password')).rejects.toMatchObject({ status: 503, message: 'Không thể tạo tài khoản Supabase Auth.' });
  });
  it('never reports success on network failure or malformed success', async () => {
    fetchMock.mockRejectedValueOnce(new Error('private credentials'));
    await expect(service.create('qa@example.test', 'long-password')).rejects.toMatchObject({ status: 503 });
    fetchMock.mockResolvedValueOnce(new Response('{}'));
    await expect(service.create('qa@example.test', 'long-password')).rejects.toMatchObject({ status: 503 });
  });
  it('compensates only the created Auth UUID and fails visibly on deletion errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}'));
    await service.remove(id);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://qa.supabase.co/auth/v1/admin/users/${id}`);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    await expect(service.remove(id)).rejects.toThrow('Auth compensation failed');
  });
});
