import type { Page, RequestOptions, Summary, TopProduct, Trend } from './api-types';
import { authorizedGet } from './backend-api';

export interface DashboardData {
  summary: Summary;
  trends: Trend[];
  top: Page<TopProduct>;
  latest: Array<{ transaction_id: string; product_name: string | null; movement_type: 'IN' | 'OUT'; quantity_packages: number; unit_name: string | null; point_name: string | null; created_at: string }>;
  low_stock: Array<{ product_id: string; product_name: string; base_unit: string; quantity_base: string }>;
}

export function getDashboard(query: { from: string; to: string; granularity: 'day' | 'month'; page: number; limit: number }, options: RequestOptions = {}) {
  return authorizedGet<DashboardData>(`/dashboard?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`, options);
}
