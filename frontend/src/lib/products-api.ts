import type { DatabaseProduct, RequestOptions } from './api-types';
import { authorizedGet } from './backend-api';

export interface ProductsResponse {
  data: DatabaseProduct[];
  count: number;
}

export function listDatabaseProducts(options: RequestOptions = {}): Promise<ProductsResponse> {
  return authorizedGet<ProductsResponse>('/products', options);
}
