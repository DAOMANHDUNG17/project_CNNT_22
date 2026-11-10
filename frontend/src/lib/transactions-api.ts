import type { DatabaseTransaction, Page, RequestOptions } from './api-types';
import { authorizedGet } from './backend-api';

export interface TransactionsQuery {
  page?: number;
  limit?: number;
  transactionId?: string;
  productId?: string;
  movementType?: 'IN' | 'OUT';
  scanPointId?: string;
  from?: string;
  to?: string;
}

export function listDatabaseTransactions(query: TransactionsQuery = {}, options: RequestOptions = {}): Promise<Page<DatabaseTransaction>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return authorizedGet<Page<DatabaseTransaction>>(`/transactions${params.size ? `?${params}` : ''}`, options);
}

// Calendar dates are selected in Vietnam time regardless of the browser's system timezone.
export function historyDateRange(startDay: string, endDayExclusive: string): Pick<TransactionsQuery, 'from' | 'to'> {
  return {
    from: new Date(`${startDay}T00:00:00+07:00`).toISOString(),
    to: new Date(`${endDayExclusive}T00:00:00+07:00`).toISOString(),
  };
}
