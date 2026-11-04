import type { MovementRequest } from './api';
export interface PendingMovement { payload: MovementRequest; createdAt: string }
export const pendingKey = (userId: string) => `warehouse:pending-movement:${userId}`;
export function parsePending(raw: string | null): PendingMovement | null {
  try {
    const candidate: unknown = JSON.parse(raw ?? 'null');
    if (!candidate || typeof candidate !== 'object' || !('payload' in candidate) || !('createdAt' in candidate)) return null;
    const payload = candidate.payload;
    if (!payload || typeof payload !== 'object') return null;
    const p = payload as Record<string,unknown>;
    if (Object.keys(p).length !== 5 || typeof p.transaction_id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(p.transaction_id)
      || !['IN','OUT'].includes(String(p.movement_type)) || !Number.isInteger(p.quantity_packages)
      || typeof p.quantity_packages !== 'number' || p.quantity_packages < 1 || p.quantity_packages > 2147483647
      || ![['scan_point_id',20],['scan_code',80]].every(([key,limit]) => {
        const value = p[String(key)]; return typeof value === 'string' && value === value.trim() && value.length > 0 && [...value].length <= Number(limit) && !value.includes('\0');
      }) || typeof candidate.createdAt !== 'string' || !Number.isFinite(Date.parse(candidate.createdAt))) return null;
    return { payload: { transaction_id:p.transaction_id,scan_point_id:String(p.scan_point_id),scan_code:String(p.scan_code),
      movement_type:p.movement_type as 'IN'|'OUT',quantity_packages:p.quantity_packages },createdAt:candidate.createdAt };
  } catch { return null; }
}
export function loadPending(userId: string): PendingMovement | null {
  try { return parsePending(sessionStorage.getItem(pendingKey(userId))); } catch { return null; }
}
export function savePending(userId: string, pending: PendingMovement | null) {
  if (pending) sessionStorage.setItem(pendingKey(userId),JSON.stringify(pending));
  else sessionStorage.removeItem(pendingKey(userId));
}
