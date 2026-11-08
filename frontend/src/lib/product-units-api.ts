import type { DatabaseProductUnit, RequestOptions } from './api-types';
import { authorizedGet } from './backend-api';

export interface ProductUnitsResponse {
  data: DatabaseProductUnit[];
  count: number;
}

export function listDatabaseProductUnits(options: RequestOptions = {}): Promise<ProductUnitsResponse> {
  return authorizedGet<ProductUnitsResponse>('/product-units', options);
}
