import { afterEach, describe, expect, it, vi } from 'vitest';
import { historyDateRange, listDatabaseTransactions } from '../../src/lib/transactions-api';
import { integer, timestamp } from '../../src/lib/format';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
afterEach(() => { getSession.mockReset(); vi.unstubAllGlobals(); });

describe('read-only transaction client', () => {
  it('sends every filter through authorized GET and preserves BIGINT/snapshots', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'test-session' } }, error: null });
    const body = { data: [{ transaction_id: 'f3a754fd-df1d-4d7f-8220-411f07415070', quantity_base: '9007199254740993', conversion_factor_snapshot: 24, scan_code_snapshot: 'OLD' }], count: 1, pagination: { page: 2, limit: 1, total: 1, totalPages: 1 } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal('fetch', fetchMock);
    const query = { page: 2, limit: 1, transactionId: body.data[0]!.transaction_id, productId: 'SP013', movementType: 'OUT' as const, scanPointId: 'SCAN-01', from: '2026-11-09T17:00:00.000Z', to: '2026-11-10T17:00:00.000Z' };
    await expect(listDatabaseTransactions(query)).resolves.toEqual(body);
    const [url, options] = fetchMock.mock.calls[0]!;
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/transactions');
    expect(Object.fromEntries(parsed.searchParams)).toEqual(Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)])));
    expect(options.headers.Authorization).toBe('Bearer test-session');
    expect(options.method).toBeUndefined();
  });
  it('does not fabricate data for missing sessions or API errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null }).mockResolvedValue({ data: { session: { access_token: 'test' } }, error: null });
    await expect(listDatabaseTransactions()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(listDatabaseTransactions()).rejects.toMatchObject({ status: 400, code: 'INVALID_QUERY' });
  });
  it('maps Vietnam calendar days to UTC and renders time/large numbers without rounding', () => {
    expect(historyDateRange('2026-11-10', '2026-11-12')).toEqual({ from: '2026-11-09T17:00:00.000Z', to: '2026-11-11T17:00:00.000Z' });
    expect(timestamp('2026-11-09T22:03:59Z')).toContain('05:03');
    expect(timestamp('2026-11-09T22:03:59Z')).toContain('10/11/2026');
    expect(integer('9007199254740993').replace(/\D/gu, '')).toBe('9007199254740993');
  });
});
