import pg from 'pg';
import { HttpError } from '../http/errors.js';
import { likePattern } from '../http/query.js';

const pick = (row, fields) => Object.fromEntries(fields.map(field => [field, row[field]]));
const stockFields = ['product_id', 'product_name', 'base_unit', 'is_active', 'quantity_base', 'updated_at'];
const userFields = ['user_id', 'username', 'display_name', 'role', 'is_active', 'created_at'];
const transactionFields = ['transaction_id', 'product_id', 'product_name', 'product_unit_id', 'unit_name',
  'scan_point_id', 'point_name', 'movement_type', 'quantity_packages', 'conversion_factor_snapshot',
  'quantity_base', 'inventory_after', 'created_at'];
const trendFields = ['period_start', 'in_count', 'out_count', 'total_count'];
const topFields = ['product_id', 'product_name', 'base_unit', 'transaction_count', 'in_count', 'out_count',
  'quantity_in_base', 'quantity_out_base'];

export function createDashboardReadRepository(db, schema = 'public') {
  const table = name => `${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(name)}`;
  const products = table('products');
  const inventory = table('inventory');
  const transactions = table('stock_transactions');
  const units = table('product_units');
  const points = table('scan_points');
  const users = table('users');

  async function page(select, values, query, fields, orderBy, key) {
    const result = await db.query(`WITH filtered AS (${select}),
      page_rows AS (SELECT * FROM filtered ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}),
      totals AS (SELECT count(*)::text AS _total FROM filtered)
      SELECT totals._total, page_rows.* FROM totals LEFT JOIN page_rows ON true
      ORDER BY ${orderBy.split(', ').map(part => `page_rows.${part}`).join(', ')}`,
    [...values, query.limit, query.offset]);
    const total = Number(result.rows[0]?._total ?? '0');
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Pagination total is outside the safe integer range.');
    const data = result.rows.filter(row => row[key] != null).map(row => pick(row, fields));
    return { data, count: data.length, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  // The date window is inclusive calendar dates in UTC. It is shared by both
  // aggregate APIs so midnight boundaries do not depend on the DB timezone.
  function movementFilters(query) {
    const values = [query.from, query.to];
    const conditions = ["t.created_at >= ($1::date::timestamp AT TIME ZONE 'UTC')",
      "t.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')"];
    for (const [name, column] of [['productId', 't.product_id'], ['movementType', 't.movement_type'], ['scanPointId', 't.scan_point_id']]) {
      if (query[name] !== undefined) { values.push(query[name]); conditions.push(`${column} = $${values.length}`); }
    }
    return { values, conditions };
  }

  return {
    listLowStock(query) {
      const values = [query.threshold];
      let where = 'i.quantity_base < $1::bigint';
      if (query.q !== undefined) {
        values.push(likePattern(query.q));
        where += " AND (p.product_id ILIKE $2 ESCAPE '!' OR p.product_name ILIKE $2 ESCAPE '!')";
      }
      return page(`SELECT p.product_id,p.product_name,p.base_unit,p.is_active,i.quantity_base,i.updated_at
        FROM ${inventory} i JOIN ${products} p ON p.product_id=i.product_id WHERE ${where}`,
      values, query, stockFields, 'product_id ASC', 'product_id');
    },

    async getTransaction(id) {
      const result = await db.query(`SELECT t.transaction_id,t.product_id,p.product_name,t.product_unit_id,u.unit_name,
        t.scan_point_id,s.point_name,t.movement_type,t.quantity_packages,t.conversion_factor_snapshot,
        t.quantity_base,t.inventory_after,t.created_at
        FROM ${transactions} t JOIN ${products} p ON p.product_id=t.product_id
        JOIN ${units} u ON u.product_unit_id=t.product_unit_id AND u.product_id=t.product_id
        JOIN ${points} s ON s.scan_point_id=t.scan_point_id WHERE t.transaction_id=$1::uuid`, [id]);
      if (!result.rows.length) throw new HttpError(404, 'TRANSACTION_NOT_FOUND', 'Transaction not found.');
      return { data: pick(result.rows[0], transactionFields) };
    },

    listUsers(query) {
      const values = [];
      const conditions = [];
      if (query.q !== undefined) {
        values.push(likePattern(query.q));
        conditions.push("(u.username ILIKE $1 ESCAPE '!' OR u.display_name ILIKE $1 ESCAPE '!')");
      }
      for (const [name, column] of [['role', 'u.role'], ['isActive', 'u.is_active']]) {
        if (query[name] !== undefined) { values.push(query[name]); conditions.push(`${column} = $${values.length}`); }
      }
      return page(`SELECT u.user_id,u.username,u.display_name,u.role,u.is_active,u.created_at
        FROM ${users} u ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`,
      values, query, userFields, 'user_id ASC', 'user_id');
    },

    async summary(query) {
      const result = await db.query(`WITH product_counts AS (
          SELECT count(*)::text AS product_total,
            count(*) FILTER (WHERE p.is_active)::text AS product_active,
            count(*) FILTER (WHERE NOT p.is_active)::text AS product_inactive,
            count(*) FILTER (WHERE i.product_id IS NULL)::text AS missing_inventory
          FROM ${products} p LEFT JOIN ${inventory} i ON i.product_id=p.product_id
        ), movement_counts AS (
          SELECT count(*)::text AS transaction_total,
            count(*) FILTER (WHERE movement_type='IN')::text AS in_count,
            count(*) FILTER (WHERE movement_type='OUT')::text AS out_count FROM ${transactions}
        ), low_stock AS (
          SELECT count(*)::text AS low_count FROM ${inventory} WHERE quantity_base < $1::bigint
        ), inventory_totals AS (
          SELECT p.base_unit,sum(i.quantity_base)::text AS quantity_base
          FROM ${inventory} i JOIN ${products} p ON p.product_id=i.product_id GROUP BY p.base_unit
        ) SELECT product_counts.*,movement_counts.*,low_stock.*,inventory_totals.base_unit,inventory_totals.quantity_base
        FROM product_counts CROSS JOIN movement_counts CROSS JOIN low_stock
        LEFT JOIN inventory_totals ON true ORDER BY inventory_totals.base_unit ASC`, [query.threshold]);
      const row = result.rows[0];
      if (!row) throw new Error('Dashboard aggregate did not return a result.');
      return { data: {
        products: { total: row.product_total, active: row.product_active, inactive: row.product_inactive, missing_inventory: row.missing_inventory },
        inventory_totals: result.rows.filter(item => item.base_unit != null).map(item => pick(item, ['base_unit', 'quantity_base'])),
        transactions: { IN: row.in_count, OUT: row.out_count, total: row.transaction_total },
        low_stock: { threshold: query.threshold, product_count: row.low_count },
      } };
    },

    stockTrends(query) {
      const { values, conditions } = movementFilters(query);
      // Only fixed allowlisted SQL fragments are used; no input becomes SQL text.
      const granularity = query.granularity === 'month' ? 'month' : 'day';
      const interval = granularity === 'month' ? '1 month' : '1 day';
      return page(`WITH buckets AS (
          SELECT generate_series(date_trunc('${granularity}',$1::date::timestamp),
            date_trunc('${granularity}',$2::date::timestamp),interval '${interval}') AS bucket
        ), movements AS (
          SELECT date_trunc('${granularity}',t.created_at AT TIME ZONE 'UTC') AS bucket,
            count(*) FILTER (WHERE t.movement_type='IN') AS in_count,
            count(*) FILTER (WHERE t.movement_type='OUT') AS out_count,count(*) AS total_count
          FROM ${transactions} t WHERE ${conditions.join(' AND ')} GROUP BY 1
        ) SELECT b.bucket AT TIME ZONE 'UTC' AS period_start,
          coalesce(m.in_count,0)::text AS in_count,coalesce(m.out_count,0)::text AS out_count,
          coalesce(m.total_count,0)::text AS total_count
        FROM buckets b LEFT JOIN movements m ON m.bucket=b.bucket`,
      values, query, trendFields, 'period_start ASC', 'period_start');
    },

    topProducts(query) {
      const { values, conditions } = movementFilters(query);
      if (query.q !== undefined) {
        values.push(likePattern(query.q));
        conditions.push(`(p.product_id ILIKE $${values.length} ESCAPE '!' OR p.product_name ILIKE $${values.length} ESCAPE '!')`);
      }
      if (query.baseUnit !== undefined) { values.push(query.baseUnit); conditions.push(`p.base_unit=$${values.length}`); }
      const rank = {
        transactions: 'count(*)',
        inQuantity: "coalesce(sum(t.quantity_base) FILTER (WHERE t.movement_type='IN'),0)",
        outQuantity: "coalesce(sum(t.quantity_base) FILTER (WHERE t.movement_type='OUT'),0)",
      }[query.sortBy] ?? 'count(*)';
      return page(`SELECT p.product_id,p.product_name,p.base_unit,count(*)::text AS transaction_count,
          count(*) FILTER (WHERE t.movement_type='IN')::text AS in_count,
          count(*) FILTER (WHERE t.movement_type='OUT')::text AS out_count,
          coalesce(sum(t.quantity_base) FILTER (WHERE t.movement_type='IN'),0)::text AS quantity_in_base,
          coalesce(sum(t.quantity_base) FILTER (WHERE t.movement_type='OUT'),0)::text AS quantity_out_base,
          ${rank} AS _rank
        FROM ${transactions} t JOIN ${products} p ON p.product_id=t.product_id
        WHERE ${conditions.join(' AND ')} GROUP BY p.product_id,p.product_name,p.base_unit`,
      values, query, topFields, '_rank DESC, product_id ASC', 'product_id');
    },
  };
}
