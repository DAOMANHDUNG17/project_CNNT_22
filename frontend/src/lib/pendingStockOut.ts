import type { StockOutRequest } from './stock-movements-api';

export interface PendingStockOut { payload: StockOutRequest; createdAt: string }
const key = (userId: string) => `warehouse:pending-stock-out:${userId}`;

export function parsePendingStockOut(raw: string | null): PendingStockOut | null {
  try {
    const candidate: unknown = JSON.parse(raw ?? 'null');
    if (!candidate || typeof candidate !== 'object') return null;
    const entry = candidate as Record<string, unknown>;
    if (!entry.payload || typeof entry.payload !== 'object' || typeof entry.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.createdAt))) return null;
    const p = entry.payload as Record<string, unknown>;
    if (!Object.keys(p).every(field => ['transaction_id', 'scan_code', 'scan_point_id', 'movement_type', 'quantity_packages'].includes(field)) ||
      ![4, 5].includes(Object.keys(p).length) ||
      (p.quantity_packages !== undefined && (!Number.isInteger(p.quantity_packages) || typeof p.quantity_packages !== 'number' || p.quantity_packages < 1 || p.quantity_packages > 2147483647)) ||
      typeof p.transaction_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(p.transaction_id) ||
      p.movement_type !== 'OUT' || typeof p.scan_code !== 'string' ||
      !p.scan_code.trim() || p.scan_code !== p.scan_code.trim() || p.scan_code.length > 80 ||
      typeof p.scan_point_id !== 'string' || !p.scan_point_id.trim() ||
      p.scan_point_id !== p.scan_point_id.trim() || p.scan_point_id.length > 20) return null;
    return { payload: p as unknown as StockOutRequest, createdAt: entry.createdAt };
  } catch { return null; }
}

export function loadPendingStockOut(userId: string): PendingStockOut | null {
  try { return parsePendingStockOut(sessionStorage.getItem(key(userId))); } catch { return null; }
}

export function savePendingStockOut(userId: string, pending: PendingStockOut | null): void {
  if (pending) sessionStorage.setItem(key(userId), JSON.stringify(pending));
  else sessionStorage.removeItem(key(userId));
}
