import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeGrantIds, getUserScanPointAccess, replaceUserScanPointAccess, sameScanPointIds } from '../../src/lib/scan-point-access-api';
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
afterEach(() => { getSession.mockReset(); vi.unstubAllGlobals(); });
describe('Scan point access client', () => {
  it('GET and PUT use backend JWT and send only the complete selected IDs', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'fixture-token' } }, error: null });
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: [], count: 0 })))); vi.stubGlobal('fetch', fetchMock);
    await getUserScanPointAccess('9007199254740993'); await replaceUserScanPointAccess('9007199254740993', ['SCAN-01', 'SCAN-02']); await replaceUserScanPointAccess('9007199254740993', []);
    expect(new URL(fetchMock.mock.calls[0]![0]).pathname).toBe('/api/users/9007199254740993/scan-points');
    expect(fetchMock.mock.calls[1]![1].method).toBe('PUT');
    expect(fetchMock.mock.calls[1]![1].headers.Authorization).toBe('Bearer fixture-token');
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ scan_point_ids: ['SCAN-01', 'SCAN-02'] });
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body)).toEqual({ scan_point_ids: [] });
  });
  it('does not fabricate successful saves without JWT or after database error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Không lưu được quyền điểm quét.' }), { status: 503 })); vi.stubGlobal('fetch', fetchMock);
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null }).mockResolvedValue({ data: { session: { access_token: 'fixture-token' } }, error: null });
    await expect(replaceUserScanPointAccess('2', [])).rejects.toMatchObject({ status: 401 }); expect(fetchMock).not.toHaveBeenCalled();
    await expect(replaceUserScanPointAccess('2', [])).rejects.toMatchObject({ status: 503, code: 'USER_MANAGEMENT_ERROR' });
  });
  it('distinguishes revoked grants and compares selections independent of ordering', () => {
    const base = { user_id: '2', point_name: 'Gate', scan_point_is_active: true, assigned_by: '1', assigned_at: '2026-11-16T00:00:00Z' };
    expect(activeGrantIds([{ ...base, scan_point_id: 'SCAN-01', is_active: false }, { ...base, scan_point_id: 'SCAN-02', is_active: true }])).toEqual(['SCAN-02']);
    expect(sameScanPointIds(['SCAN-01', 'SCAN-02'], ['SCAN-02', 'SCAN-01'])).toBe(true); expect(sameScanPointIds(['SCAN-01'], [])).toBe(false);
  });
});
