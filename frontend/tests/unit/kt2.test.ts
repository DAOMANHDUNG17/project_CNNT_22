import { afterEach, describe, expect, it, vi } from 'vitest';
import { originalRetryPayload, readKt2State, transactionUuid } from '../../src/lib/kt2';
import { retryStockIn } from '../../src/lib/stock-movements-api';
import type { DatabaseTransaction } from '../../src/lib/api-types';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
afterEach(() => { getSession.mockReset(); vi.unstubAllGlobals(); });

const row = {
  transaction_id: 'f3a754fd-df1d-4d7f-8220-411f07415070', product_id: 'SP013',
  scan_code_snapshot: 'OLD-CODE', scan_point_id: 'SCAN-01', movement_type: 'IN',
} as DatabaseTransaction;

describe('KT2 client evidence', () => {
  it('requires a UUID and retries only the four persisted identity fields with actual HTTP status', async () => {
    expect(transactionUuid.test(row.transaction_id)).toBe(true);
    expect(transactionUuid.test('OLD-CODE')).toBe(false);
    const payload = originalRetryPayload(row);
    expect(payload).toEqual({ transaction_id: row.transaction_id, scan_code: 'OLD-CODE', scan_point_id: 'SCAN-01', movement_type: 'IN' });
    getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { transaction_id: row.transaction_id } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await retryStockIn(payload)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/stock-movements$/), expect.objectContaining({
      method: 'POST', body: JSON.stringify(payload), headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
    }));
  });

  it('reads inventory, product total metadata and exact UUID count from GET endpoints', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null });
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/inventory')) return new Response(JSON.stringify({ data: [{ product_id: 'SP013', quantity_base: '48' }] }));
      if (url.includes('productId=SP013')) return new Response(JSON.stringify({ data: [{}], pagination: { total: 22 } }));
      return new Response(JSON.stringify({ data: [row], pagination: { total: 1 } }));
    }));
    expect(await readKt2State(row)).toEqual({ inventory: '48', total: 22, uuidCount: 1 });
    expect(urls).toHaveLength(3);
    expect(urls.every(url => !url.includes('/stock-movements'))).toBe(true);
  });
});
