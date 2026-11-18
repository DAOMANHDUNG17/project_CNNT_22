import { afterEach, describe, expect, it, vi } from 'vitest';
import { newTransactionId } from '../../src/lib/transaction-id';
import { parsePendingStockIn } from '../../src/lib/pendingStockIn';
import { parsePendingStockOut } from '../../src/lib/pendingStockOut';

afterEach(() => vi.unstubAllGlobals());
const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
describe('CSPRNG transaction UUID v4', () => {
  it('generates distinct PostgreSQL-compatible v4 IDs for new transactions', () => {
    const ids = Array.from({ length: 2000 }, () => newTransactionId());
    expect(ids.every(id => pattern.test(id))).toBe(true); expect(new Set(ids).size).toBe(ids.length);
  });
  it('works when randomUUID is unavailable and fixes only version/variant bits', () => {
    const random = vi.fn((bytes: Uint8Array) => bytes.fill(255));
    vi.stubGlobal('crypto', { getRandomValues: random });
    expect(newTransactionId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(random).toHaveBeenCalledTimes(1); expect(random.mock.calls[0]![0]).toHaveLength(16);
  });
  it('never falls back to weak randomness if secure randomness is unavailable', () => {
    vi.stubGlobal('crypto', {}); expect(() => newTransactionId()).toThrow('không hỗ trợ');
  });
  it('keeps pending IN/OUT UUIDs unchanged across parsing/retry while a new transaction gets a new ID', () => {
    const id = newTransactionId(); const payload = { transaction_id: id, scan_code: 'BOX24', scan_point_id: 'SCAN-01', movement_type: 'IN', quantity_packages: 2 };
    const incoming = parsePendingStockIn(JSON.stringify({ payload, createdAt: '2026-11-17T00:00:00Z' }));
    const outgoing = parsePendingStockOut(JSON.stringify({ payload: { ...payload, movement_type: 'OUT' }, createdAt: '2026-11-17T00:00:00Z' }));
    expect(incoming?.payload.transaction_id).toBe(id); expect(outgoing?.payload.transaction_id).toBe(id); expect(newTransactionId()).not.toBe(id);
  });
});
