import { mockApi } from './mock-api';
export { listDatabaseProducts } from './products-api';
export * from './api-types';

// Stable API abstraction backed by development-only Mock Mode for now.
export const api = mockApi;

export async function allPages<T>(load: (page: number) => Promise<{ data: T[]; pagination: { totalPages: number } }>, signal: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    signal.throwIfAborted();
    const response = await load(page);
    rows.push(...response.data);
    pages = response.pagination.totalPages;
  }
  return rows;
}

export class OutcomeUnknownError extends Error {
  constructor() { super('Chưa nhận được kết quả. Giữ nguyên mã giao dịch để kiểm tra lại.'); }
}
export async function movementDeadline<T>(operation: Promise<T>, milliseconds = 15000): Promise<T> {
  // A transport timeout is never proof of rollback. The original HTTP request
  // may finish later; replay of the frozen UUID/payload resolves the outcome.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new OutcomeUnknownError()), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
