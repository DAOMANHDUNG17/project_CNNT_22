import pg from 'pg';
import { HttpError, productNotFound } from '../http/errors.js';
import { likePattern } from '../http/query.js';

const productFields = ['product_id', 'product_name', 'base_unit', 'is_active', 'created_at'];
const unitFields = ['product_unit_id', 'product_id', 'unit_name', 'conversion_factor', 'scan_code', 'is_base_unit'];
const inventoryFields = ['product_id', 'product_name', 'base_unit', 'is_active', 'quantity_base', 'updated_at'];
const transactionFields = ['transaction_id', 'product_id', 'product_name', 'product_unit_id', 'unit_name',
  'scan_point_id', 'point_name', 'movement_type', 'quantity_packages', 'conversion_factor_snapshot',
  'quantity_base', 'inventory_after', 'created_at'];
const pointFields = ['scan_point_id', 'point_name', 'is_active'];
const pick = (row, fields) => Object.fromEntries(fields.map((field) => [field, row[field]]));
const columns = (alias, fields) => fields.map((field) => `${alias}.${field}`).join(', ');

export function createReadRepository(db, schema) {
  const table = (name) => `${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier(name)}`;
  const products = table('products');
  const units = table('product_units');
  const inventory = table('inventory');
  const transactions = table('stock_transactions');
  const points = table('scan_points');

  async function page(select, values, query, fields, orderBy, key) {
    // One statement gives count and data the same PostgreSQL snapshot, even for an empty page.
    // Avoid JSON aggregation: pg preserves int8 as strings; JSON numeric parsing would lose precision.
    const result = await db.query(`WITH filtered AS (${select}),
      page_rows AS (SELECT * FROM filtered ORDER BY ${orderBy} LIMIT $${values.length + 1} OFFSET $${values.length + 2}),
      totals AS (SELECT count(*)::text AS _total FROM filtered)
      SELECT totals._total, page_rows.* FROM totals LEFT JOIN page_rows ON true
      ORDER BY ${orderBy.split(', ').map((part) => `page_rows.${part}`).join(', ')}`,
    [...values, query.limit, query.offset]);
    const total = Number(result.rows[0]?._total ?? '0');
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('Pagination total is outside the safe integer range.');
    const data = result.rows.filter((row) => row[key] != null).map((row) => pick(row, fields));
    return { data, count: data.length, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  return {
    listProducts(query) {
      const values = query.q === undefined ? [] : [likePattern(query.q)];
      const where = query.q === undefined ? '' : " WHERE (p.product_id ILIKE $1 ESCAPE '!' OR p.product_name ILIKE $1 ESCAPE '!')";
      return page(`SELECT ${columns('p', productFields)} FROM ${products} p${where}`,
        values, query, productFields, 'product_id ASC', 'product_id');
    },
    async getProduct(id) {
      const result = await db.query(`SELECT ${columns('p', productFields)},
        ${unitFields.map((field) => `u.${field} AS _unit_${field}`).join(', ')}
        FROM ${products} p LEFT JOIN ${units} u ON u.product_id = p.product_id
        WHERE p.product_id = $1 ORDER BY u.product_unit_id ASC`, [id]);
      if (!result.rows.length) throw productNotFound();
      return { data: { ...pick(result.rows[0], productFields),
        units: result.rows.filter((row) => row._unit_product_unit_id != null).map((row) =>
          Object.fromEntries(unitFields.map((field) => [field, row[`_unit_${field}`]]))) } };
    },
    listInventory(query) {
      return page(`SELECT p.product_id, p.product_name, p.base_unit, p.is_active, i.quantity_base, i.updated_at
        FROM ${inventory} i JOIN ${products} p ON p.product_id = i.product_id`,
      [], query, inventoryFields, 'product_id ASC', 'product_id');
    },
    async getInventory(id) {
      const result = await db.query(`SELECT p.product_id, p.product_name, p.base_unit, p.is_active,
        i.product_id AS _inventory_product_id, i.quantity_base, i.updated_at
        FROM ${products} p LEFT JOIN ${inventory} i ON i.product_id = p.product_id
        WHERE p.product_id = $1`, [id]);
      if (!result.rows.length) throw productNotFound();
      if (result.rows[0]._inventory_product_id == null) {
        throw new HttpError(404, 'INVENTORY_NOT_FOUND', 'Inventory record not found.');
      }
      return { data: pick(result.rows[0], inventoryFields) };
    },
    listTransactions(query) {
      const values = [];
      const conditions = [];
      for (const [param, column] of [['productId', 't.product_id'], ['movementType', 't.movement_type'], ['scanPointId', 't.scan_point_id']]) {
        if (query[param] !== undefined) { values.push(query[param]); conditions.push(`${column} = $${values.length}`); }
      }
      return page(`SELECT t.transaction_id, t.product_id, p.product_name, t.product_unit_id, u.unit_name,
        t.scan_point_id, s.point_name, t.movement_type, t.quantity_packages, t.conversion_factor_snapshot,
        t.quantity_base, t.inventory_after, t.created_at
        FROM ${transactions} t JOIN ${products} p ON p.product_id = t.product_id
        JOIN ${units} u ON u.product_unit_id = t.product_unit_id AND u.product_id = t.product_id
        JOIN ${points} s ON s.scan_point_id = t.scan_point_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`, values, query,
      transactionFields, 'created_at DESC, transaction_id DESC', 'transaction_id');
    },
    listScanPoints(query) {
      return page(`SELECT ${columns('s', pointFields)} FROM ${points} s`, [], query, pointFields, 'scan_point_id ASC', 'scan_point_id');
    },
  };
}
