import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DashboardQueryDto } from './dashboard-query.dto';

@Injectable()
export class DashboardService {
  constructor(private readonly database: DatabaseService) {}

  async get(query: DashboardQueryDto) {
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if ((query.from && !validDate(query.from)) || (query.to && !validDate(query.to)) || (query.from && query.to && query.from > query.to)) {
      throw new BadRequestException('Invalid UTC date range');
    }
    const dates = [query.from ?? null, query.to ?? null];
    const period = [query.from ?? null, query.to ?? null, query.granularity];
    const products = await this.database.query(`SELECT count(*)::text AS total,
      count(*) FILTER (WHERE is_active)::text AS active,
      count(*) FILTER (WHERE NOT is_active)::text AS inactive,
      count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.inventory i WHERE i.product_id = p.product_id))::text AS missing_inventory
      FROM public.products p`);
    const units = await this.database.query(`SELECT p.base_unit, sum(i.quantity_base)::text AS quantity_base
      FROM public.inventory i JOIN public.products p ON p.product_id = i.product_id
      GROUP BY p.base_unit ORDER BY p.base_unit`);
    const totals = await this.database.query(`SELECT count(*)::text AS total,
      count(*) FILTER (WHERE movement_type = 'IN')::text AS in_count,
      count(*) FILTER (WHERE movement_type = 'OUT')::text AS out_count
      FROM public.stock_transactions`);
    const lowCount = await this.database.query(`SELECT count(*)::text AS product_count
      FROM public.inventory WHERE quantity_base < $1`, [10]);
    const trends = await this.database.query(`SELECT to_char(date_trunc($3, t.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS period,
      count(*) FILTER (WHERE t.movement_type = 'IN')::text AS in_count,
      count(*) FILTER (WHERE t.movement_type = 'OUT')::text AS out_count,
      count(*)::text AS total_count
      FROM public.stock_transactions t
      WHERE ($1::date IS NULL OR t.created_at >= ($1::date::timestamp AT TIME ZONE 'UTC'))
        AND ($2::date IS NULL OR t.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC'))
      GROUP BY 1 ORDER BY 1`, period);
    const top = await this.database.query(`WITH ranked AS (
      SELECT t.product_id, p.product_name, p.base_unit, count(*)::text AS transaction_count,
        count(*) FILTER (WHERE t.movement_type = 'IN')::text AS in_count,
        count(*) FILTER (WHERE t.movement_type = 'OUT')::text AS out_count,
        coalesce(sum(t.quantity_base) FILTER (WHERE t.movement_type = 'IN'), 0)::text AS quantity_in_base,
        coalesce(sum(t.quantity_base) FILTER (WHERE t.movement_type = 'OUT'), 0)::text AS quantity_out_base,
        count(*) AS rank_count
      FROM public.stock_transactions t JOIN public.products p ON p.product_id = t.product_id
      WHERE ($1::date IS NULL OR t.created_at >= ($1::date::timestamp AT TIME ZONE 'UTC'))
        AND ($2::date IS NULL OR t.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC'))
      GROUP BY t.product_id, p.product_name, p.base_unit
    ) SELECT r.*, totals.total FROM (SELECT count(*)::text AS total FROM ranked) totals
      LEFT JOIN LATERAL (SELECT * FROM ranked ORDER BY rank_count DESC, product_id
        LIMIT $3 OFFSET $4::bigint) r ON true`, [...dates, query.limit, ((BigInt(query.page) - 1n) * BigInt(query.limit)).toString()]);
    const latest = await this.database.query(`SELECT t.transaction_id, t.product_id, p.product_name, t.movement_type,
      t.quantity_packages, u.unit_name, s.point_name, t.created_at
      FROM public.stock_transactions t
      LEFT JOIN public.products p ON p.product_id = t.product_id
      LEFT JOIN public.product_units u ON u.product_unit_id = t.product_unit_id AND u.product_id = t.product_id
      LEFT JOIN public.scan_points s ON s.scan_point_id = t.scan_point_id
      ORDER BY t.created_at DESC, t.transaction_id DESC LIMIT 5`);
    const low = await this.database.query(`SELECT i.product_id, p.product_name, p.base_unit, i.quantity_base::text AS quantity_base
      FROM public.inventory i JOIN public.products p ON p.product_id = i.product_id
      WHERE i.quantity_base < $1 ORDER BY i.quantity_base, i.product_id LIMIT 5`, [10]);
    const topTotal = Number(top[0]?.total ?? '0');
    if (!Number.isSafeInteger(topTotal)) throw new Error('Top product count exceeds safe integer range');
    return {
      summary: {
        products: { total: String(products[0]?.total ?? '0'), active: String(products[0]?.active ?? '0'), inactive: String(products[0]?.inactive ?? '0'), missing_inventory: String(products[0]?.missing_inventory ?? '0') },
        inventory_totals: units.map(row => ({ base_unit: String(row.base_unit), quantity_base: String(row.quantity_base) })),
        transactions: { IN: String(totals[0]?.in_count ?? '0'), OUT: String(totals[0]?.out_count ?? '0'), total: String(totals[0]?.total ?? '0') },
        low_stock: { threshold: '10', product_count: String(lowCount[0]?.product_count ?? '0') },
      },
      trends: trends.map(row => ({ period_start: `${row.period}T00:00:00Z`, in_count: String(row.in_count), out_count: String(row.out_count), total_count: String(row.total_count) })),
      top: { data: top.filter(row => row.product_id != null).map(row => ({ product_id: row.product_id, product_name: row.product_name, base_unit: row.base_unit, transaction_count: String(row.transaction_count), in_count: String(row.in_count), out_count: String(row.out_count), quantity_in_base: String(row.quantity_in_base), quantity_out_base: String(row.quantity_out_base) })), count: topTotal,
        pagination: { page: query.page, limit: query.limit, total: topTotal, totalPages: Math.ceil(topTotal / query.limit) } },
      latest: latest.map(row => ({ transaction_id: String(row.transaction_id), product_id: String(row.product_id),
        product_name: row.product_name as string | null, movement_type: row.movement_type as 'IN' | 'OUT',
        quantity_packages: row.quantity_packages as number, unit_name: row.unit_name as string | null,
        point_name: row.point_name as string | null, created_at: row.created_at as Date })),
      low_stock: low.map(row => ({ product_id: row.product_id, product_name: row.product_name, base_unit: row.base_unit, quantity_base: String(row.quantity_base) })),
    };
  }
}
