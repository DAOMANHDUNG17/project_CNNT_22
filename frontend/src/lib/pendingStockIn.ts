import type { StockInRequest } from './stock-movements-api';

export interface PendingStockIn { payload: StockInRequest; createdAt: string }
const key = (userId: string) => `warehouse:pending-stock-in:${userId}`;

export function parsePendingStockIn(raw: string | null): PendingStockIn | null {
  try {
    const candidate: unknown = JSON.parse(raw ?? 'null');
    if (!candidate || typeof candidate !== 'object') return null;
    const entry = candidate as Record<string, unknown>;
    if (!entry.payload || typeof entry.payload !== 'object' || typeof entry.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.createdAt))) return null;
    const p = entry.payload as Record<string, unknown>;
    if (Object.keys(p).length !== 4 || typeof p.transaction_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(p.transaction_id) ||
      p.movement_type !== 'IN' || typeof p.scan_code !== 'string' ||
      !p.scan_code.trim() || p.scan_code !== p.scan_code.trim() || p.scan_code.length > 80 ||
      typeof p.scan_point_id !== 'string' || !p.scan_point_id.trim() ||
      p.scan_point_id !== p.scan_point_id.trim() || p.scan_point_id.length > 20) return null;
    return { payload: p as unknown as StockInRequest, createdAt: entry.createdAt };
  } catch { return null; }
}

export function loadPendingStockIn(userId: string): PendingStockIn | null {
  try { return parsePendingStockIn(sessionStorage.getItem(key(userId))); } catch { return null; }
}

export function savePendingStockIn(userId: string, pending: PendingStockIn | null): void {
  if (pending) sessionStorage.setItem(key(userId), JSON.stringify(pending));
  else sessionStorage.removeItem(key(userId));
}
