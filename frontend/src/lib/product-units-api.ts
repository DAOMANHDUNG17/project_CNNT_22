import type { Data, DatabaseProductUnit, RequestOptions } from './api-types';
import { authorizedGet, authorizedPatch, authorizedPost } from './backend-api';

export interface ProductUnitsResponse {
  data: DatabaseProductUnit[];
  count: number;
}

export function listDatabaseProductUnits(options: RequestOptions = {}): Promise<ProductUnitsResponse> {
  return authorizedGet<ProductUnitsResponse>('/product-units', options);
}

export type CreateProductUnitRequest = Pick<DatabaseProductUnit, 'product_id' | 'unit_name' | 'conversion_factor' | 'scan_code' | 'is_base_unit'>;

export function createDatabaseProductUnit(body: CreateProductUnitRequest): Promise<Data<DatabaseProductUnit>> {
  return authorizedPost<Data<DatabaseProductUnit>>('/product-units', body);
}

export type PatchProductUnitRequest = Partial<Pick<DatabaseProductUnit, 'unit_name' | 'scan_code' | 'conversion_factor'>>;

export function updateDatabaseProductUnit(id: string, body: PatchProductUnitRequest): Promise<Data<DatabaseProductUnit>> {
  return authorizedPatch<Data<DatabaseProductUnit>>(`/product-units/${encodeURIComponent(id)}`, body);
}
