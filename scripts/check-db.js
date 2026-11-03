import assert from 'node:assert/strict';
import { readConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';
import { logError } from '../src/middleware/error-handler.js';

let pool;
try {
  const config = readConfig();
  pool = createPool(config.database);
  const identity = await pool.query(`SELECT current_database() AS database,
    current_user AS role, current_setting('transaction_read_only') AS read_only,
    (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser`);
  assert.equal(identity.rows[0].is_superuser, false, 'Application role must not be a superuser.');
  assert.equal(identity.rows[0].read_only, 'on');
  console.info(identity.rows[0]);
  const columns = await pool.query(`SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = ANY($2::text[])
    ORDER BY table_name, ordinal_position`, [config.schema,
    ['users', 'products', 'product_units', 'scan_points', 'inventory', 'stock_transactions']]);
  console.table(columns.rows);
  // Metadata visibility alone does not prove SELECT permission; check the real table.
  const { default: pg } = await import('pg');
  await pool.query(`SELECT * FROM ${pg.escapeIdentifier(config.schema)}."products" LIMIT 0`);
  console.info('Database connection and products SELECT permission: OK');
} catch (error) {
  logError(console, 'database_check_failed', error);
  if (!pool) console.error(error.message);
  process.exitCode = 1;
} finally {
  if (pool) await pool.end();
}
