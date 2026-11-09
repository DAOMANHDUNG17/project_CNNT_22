import type { Data } from './api-types';
import { authorizedPost } from './backend-api';

export interface StockInRequest {
  transaction_id: string;
  scan_code: string;
  scan_point_id: string;
  movement_type: 'IN';
}

export interface StockInResult {
  transaction_id: string;
  product_id: string;
  product_name: string;
  product_unit_id: string;
  unit_name: string;
  scan_code_snapshot: string;
  scan_point_id: string;
  user_id: string;
  movement_type: 'IN';
  quantity_packages: number;
  conversion_factor_snapshot: number;
  quantity_base: string;
  inventory_before: string;
  inventory_after: string;
  created_at: string;
}

export function createStockIn(body: StockInRequest): Promise<Data<StockInResult>> {
  return authorizedPost<Data<StockInResult>>('/stock-movements', body);
}
