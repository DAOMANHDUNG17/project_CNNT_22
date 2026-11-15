import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStockIn, createStockOut } from '../../src/lib/stock-movements-api';
import { parsePendingStockIn } from '../../src/lib/pendingStockIn';
import { parsePendingStockOut } from '../../src/lib/pendingStockOut';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }));
afterEach(() => { getSession.mockReset(); vi.unstubAllGlobals(); });

const payload = { transaction_id: '550e8400-e29b-41d4-a716-446655440000', scan_code: 'BOX24', scan_point_id: 'SCAN-01', movement_type: 'IN' as const };

describe('stock IN client', () => {
  it('sends one package request without client inventory/factor and with bearer JWT', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { transaction_id: payload.transaction_id } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await createStockIn(payload);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/stock-movements$/), {
      method: 'POST', headers: { Authorization: 'Bearer session-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  });

  it('never posts without a session and retains backend business errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Điểm quét đã ngừng hoạt động.' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null });
    await expect(createStockIn(payload)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(createStockIn(payload)).rejects.toMatchObject({ status: 409, message: 'Điểm quét đã ngừng hoạt động.' });
  });

  it('restores only a frozen IN request with the same UUID and fields', () => {
    const pending = { payload, createdAt: '2026-11-10T00:00:00Z' };
    expect(parsePendingStockIn(JSON.stringify(pending))).toEqual(pending);
    expect(parsePendingStockIn(JSON.stringify({ ...pending, payload: { ...payload, quantity_base: '24' } }))).toBe(null);
    expect(parsePendingStockIn(JSON.stringify({ ...pending, payload: { ...payload, movement_type: 'OUT' } }))).toBe(null);
    expect(parsePendingStockIn(JSON.stringify({ ...pending, payload: { ...payload, quantity_packages: 3 } }))?.payload.quantity_packages).toBe(3);
    expect(parsePendingStockIn(JSON.stringify({ ...pending, payload: { ...payload, quantity_packages: 0 } }))).toBeNull();
  });
});

describe('stock OUT client', () => {
  const out = { ...payload, movement_type: 'OUT' as const };

  it('sends only UUID, barcode, point and OUT under bearer JWT', async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { transaction_id: out.transaction_id } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    await createStockOut(out);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/stock-movements$/), {
      method: 'POST', headers: { Authorization: 'Bearer session-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(out),
    });
    expect(Object.keys(out).sort()).toEqual(['movement_type', 'scan_code', 'scan_point_id', 'transaction_id']);
  });

  it('preserves backend insufficient-stock details and requires a session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: 'Không đủ tồn kho để xuất.' }), { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValue({ data: { session: { access_token: 'session-token' } }, error: null });
    await expect(createStockOut(out)).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(createStockOut(out)).rejects.toMatchObject({ status: 409, message: 'Không đủ tồn kho để xuất.' });
  });

  it('restores only an exact OUT payload and never accepts IN or client quantities', () => {
    const pending = { payload: out, createdAt: '2026-11-15T00:00:00Z' };
    expect(parsePendingStockOut(JSON.stringify(pending))).toEqual(pending);
    expect(parsePendingStockOut(JSON.stringify({ ...pending, payload: { ...out, quantity_packages: 2 } }))?.payload.quantity_packages).toBe(2);
    expect(parsePendingStockOut(JSON.stringify({ ...pending, payload: { ...out, quantity_packages: 1.5 } }))).toBeNull();
    expect(parsePendingStockOut(JSON.stringify({ ...pending, payload: { ...out, quantity_base: '24' } }))).toBeNull();
    expect(parsePendingStockOut(JSON.stringify({ ...pending, payload }))).toBeNull();
    expect(parsePendingStockOut('not-json')).toBeNull();
  });
});
