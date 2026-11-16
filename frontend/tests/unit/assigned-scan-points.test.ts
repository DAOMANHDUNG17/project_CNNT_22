import { afterEach, describe, expect, it, vi } from 'vitest';
import { listMyScanPoints } from '../../src/lib/scan-points-api';
import { errorMessage } from '../../src/lib/format';
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
afterEach(() => { getSession.mockReset(); vi.unstubAllGlobals(); });
describe('server-assigned scan point client', () => {
  it('uses only authenticated /my GET without user/station queries', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'fixture-token' } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [], count: 0 }))); vi.stubGlobal('fetch', fetchMock);
    await listMyScanPoints(); const [url, options] = fetchMock.mock.calls[0]!;
    expect(new URL(url).pathname).toBe('/api/scan-points/my'); expect(new URL(url).search).toBe(''); expect(options.headers.Authorization).toBe('Bearer fixture-token');
  });
  it('preserves assignment 403 reasons and never fabricates a usable point', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'fixture-token' } }, error: null });
    const reason = 'Tài khoản có nhiều điểm quét active. Liên hệ ADMIN để xử lý phân công.';
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ message: reason }), { status: 403 }))));
    await expect(listMyScanPoints()).rejects.toMatchObject({ status: 403, code: 'ASSIGNED_SCAN_POINT_ERROR' });
    try { await listMyScanPoints(); } catch (error) { expect(errorMessage(error)).toBe(reason); }
  });
});
