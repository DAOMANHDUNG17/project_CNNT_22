import type { DatabaseScanPoint, RequestOptions } from './api-types';
import { authorizedGet } from './backend-api';

export interface ScanPointsResponse {
  data: DatabaseScanPoint[];
  count: number;
}

export function listDatabaseScanPoints(options: RequestOptions = {}): Promise<ScanPointsResponse> {
  return authorizedGet<ScanPointsResponse>('/scan-points', options);
}
