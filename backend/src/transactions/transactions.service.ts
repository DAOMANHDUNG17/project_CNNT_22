import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TransactionsQueryDto } from './transactions-query.dto';

export interface HistoryTransaction {
  transaction_id: string;
  product_id: string;
  product_name: string | null;
  product_unit_id: string;
  unit_name: string | null;
  movement_type: 'IN' | 'OUT';
  quantity_packages: number;
  conversion_factor_snapshot: number;
  quantity_base: string;
  inventory_before: string;
  inventory_after: string;
  scan_code_snapshot: string;
  scan_point_id: string;
  point_name: string | null;
  user_id: string;
  display_name: string | null;
  created_at: Date;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  constructor(private readonly database: DatabaseService) {}

  async findAll(query: TransactionsQueryDto) {
    if (query.from && query.to && this.epochMicros(query.from) >= this.epochMicros(query.to)) {
      throw new BadRequestException('from must be before to');
    }
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];
    const filters = [
      ['t.transaction_id', query.transactionId], ['t.product_id', query.productId],
      ['t.movement_type', query.movementType], ['t.scan_point_id', query.scanPointId],
    ] as const;
    for (const [column, value] of filters) {
      if (value !== undefined) {
        parameters.push(value);
        conditions.push(`${column} = $${parameters.length}`);
      }
    }
    for (const [operator, value] of [['>=', query.from], ['<', query.to]] as const) {
      if (value !== undefined) {
        if (!Number.isFinite(Date.parse(value))) throw new BadRequestException('Invalid datetime');
        parameters.push(value);
        conditions.push(`t.created_at ${operator} $${parameters.length}::timestamptz`);
      }
    }
    parameters.push(query.limit, ((BigInt(query.page) - 1n) * BigInt(query.limit)).toString());
    // One statement keeps COUNT and the page on the same PostgreSQL snapshot, including empty pages.
    const statement = `WITH filtered AS MATERIALIZED (
      SELECT t.transaction_id, t.product_id, p.product_name, t.product_unit_id, u.unit_name,
        t.movement_type, t.quantity_packages, t.conversion_factor_snapshot, t.quantity_base,
        t.inventory_before, t.inventory_after, t.scan_code_snapshot, t.scan_point_id,
        s.point_name, t.user_id, usr.display_name, t.created_at
      FROM public.stock_transactions AS t
      LEFT JOIN public.products AS p ON p.product_id = t.product_id
      LEFT JOIN public.product_units AS u ON u.product_unit_id = t.product_unit_id AND u.product_id = t.product_id
      LEFT JOIN public.scan_points AS s ON s.scan_point_id = t.scan_point_id
      LEFT JOIN public.users AS usr ON usr.user_id = t.user_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    )
    SELECT page_rows.*, totals.total FROM (SELECT count(*)::text AS total FROM filtered) AS totals
    LEFT JOIN LATERAL (
      SELECT * FROM filtered ORDER BY created_at DESC, transaction_id DESC
      LIMIT $${parameters.length - 1} OFFSET $${parameters.length}
    ) AS page_rows ON true
    ORDER BY page_rows.created_at DESC, page_rows.transaction_id DESC`;

    try {
      const rows = await this.database.query(statement, parameters);
      const total = Number(rows[0]?.total ?? 0);
      if (!Number.isSafeInteger(total)) throw new Error('History count exceeds safe integer range');
      const data: HistoryTransaction[] = rows.filter(row => row.transaction_id != null).map(row => ({
        transaction_id: row.transaction_id as string,
        product_id: row.product_id as string,
        product_name: row.product_name as string | null,
        product_unit_id: String(row.product_unit_id),
        unit_name: row.unit_name as string | null,
        movement_type: row.movement_type as 'IN' | 'OUT',
        quantity_packages: row.quantity_packages as number,
        conversion_factor_snapshot: row.conversion_factor_snapshot as number,
        quantity_base: String(row.quantity_base),
        inventory_before: String(row.inventory_before),
        inventory_after: String(row.inventory_after),
        scan_code_snapshot: row.scan_code_snapshot as string,
        scan_point_id: row.scan_point_id as string,
        point_name: row.point_name as string | null,
        user_id: String(row.user_id),
        display_name: row.display_name as string | null,
        created_at: row.created_at as Date,
      }));
      if (data.some(row => [row.product_name, row.unit_name, row.point_name, row.display_name].includes(null))) {
        this.logger.warn('Transaction history contains missing descriptive data');
      }
      return { data, count: total, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
    } catch {
      throw new InternalServerErrorException('Unable to load transaction history');
    }
  }

  private epochMicros(value: string): bigint {
    const parts = /^(.*?)(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    const millis = parts ? Date.parse(`${parts[1]}${parts[3]}`) : NaN;
    if (!Number.isFinite(millis)) throw new BadRequestException('Invalid datetime');
    return BigInt(millis) * 1000n + BigInt((parts?.[2] ?? '').padEnd(6, '0'));
  }
}
