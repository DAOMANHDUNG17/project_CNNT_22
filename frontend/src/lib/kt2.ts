import type { DatabaseTransaction } from './api-types';
import { listDatabaseInventory } from './inventory-api';
import { listDatabaseTransactions } from './transactions-api';
import type { StockInRequest } from './stock-movements-api';

export const transactionUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface Kt2State {
  inventory: string;
  total: number;
  uuidCount: number;
}

export function originalRetryPayload(row: DatabaseTransaction): StockInRequest {
  return {
    transaction_id: row.transaction_id,
    scan_code: row.scan_code_snapshot,
    scan_point_id: row.scan_point_id,
    movement_type: 'IN',
  };
}

export async function readKt2State(row: DatabaseTransaction): Promise<Kt2State> {
  const [inventory, productHistory, exact] = await Promise.all([
    listDatabaseInventory(),
    listDatabaseTransactions({ productId: row.product_id, page: 1, limit: 1 }),
    listDatabaseTransactions({ transactionId: row.transaction_id, page: 1, limit: 1 }),
  ]);
  const stock = inventory.data.find(item => item.product_id === row.product_id);
  const exactRow = exact.data[0];
  if (!stock || !/^(0|[1-9]\d*)$/u.test(stock.quantity_base) ||
    !Number.isSafeInteger(productHistory.pagination.total) ||
    !Number.isSafeInteger(exact.pagination.total) ||
    exact.pagination.total !== 1 || exact.data.length !== 1 || !exactRow ||
    exactRow.transaction_id !== row.transaction_id || exactRow.product_id !== row.product_id) {
    throw new Error('Không thể xác minh trạng thái tồn kho và giao dịch hiện tại.');
  }
  return { inventory: stock.quantity_base, total: productHistory.pagination.total, uuidCount: exact.pagination.total };
}
