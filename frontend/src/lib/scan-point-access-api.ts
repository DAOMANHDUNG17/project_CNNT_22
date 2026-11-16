import type { RequestOptions } from './api-types';
import { authorizedGet, authorizedPut } from './backend-api';

export interface UserScanPointGrant {
  user_id: string; scan_point_id: string; point_name: string;
  is_active: boolean; scan_point_is_active: boolean; assigned_by: string | null; assigned_at: string;
}
export interface ScanPointAccessResponse { data: UserScanPointGrant[]; count: number }
export function getUserScanPointAccess(id: string, options: RequestOptions = {}): Promise<ScanPointAccessResponse> {
  return authorizedGet(`/users/${encodeURIComponent(id)}/scan-points`, options);
}
export function replaceUserScanPointAccess(id: string, ids: string[]): Promise<ScanPointAccessResponse> {
  return authorizedPut(`/users/${encodeURIComponent(id)}/scan-points`, { scan_point_ids: ids });
}
export function activeGrantIds(grants: UserScanPointGrant[]): string[] {
  return grants.filter(grant => grant.is_active).map(grant => grant.scan_point_id);
}
export function sameScanPointIds(first: string[], second: string[]): boolean {
  return first.length === second.length && first.every(id => second.includes(id));
}
