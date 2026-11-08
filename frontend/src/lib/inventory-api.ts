import type { Inventory, RequestOptions } from './api-types';
import { authorizedGet } from './backend-api';

export interface InventoryResponse {
  data: Inventory[];
  count: number;
}

export function listDatabaseInventory(options: RequestOptions = {}): Promise<InventoryResponse> {
  return authorizedGet<InventoryResponse>('/inventory', options);
}
