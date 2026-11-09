import { ApiError } from './api-types';
import type { Data, DatabaseProduct, RequestOptions } from './api-types';
import { authorizedGet, authorizedPatch, authorizedPost } from './backend-api';

export interface ProductsResponse {
  data: DatabaseProduct[];
  count: number;
}

export function listDatabaseProducts(options: RequestOptions = {}): Promise<ProductsResponse> {
  return authorizedGet<ProductsResponse>('/products', options);
}

export type CreateProductRequest = Pick<DatabaseProduct, 'product_id' | 'product_name' | 'base_unit'>;

export async function createDatabaseProduct(body: CreateProductRequest): Promise<Data<DatabaseProduct>> {
  try {
    return await authorizedPost<Data<DatabaseProduct>>('/products', body);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      throw new ApiError(409, 'PRODUCT_ID_CONFLICT', 'Mã sản phẩm đã tồn tại.');
    }
    throw error;
  }
}

export type PatchProductRequest = Partial<Pick<DatabaseProduct, 'product_name' | 'is_active'>>;

export function updateDatabaseProduct(id: string, body: PatchProductRequest): Promise<Data<DatabaseProduct>> {
  return authorizedPatch<Data<DatabaseProduct>>(`/products/${encodeURIComponent(id)}`, body);
}
