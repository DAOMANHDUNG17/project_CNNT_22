import { readFileSync } from 'node:fs';
import pg from 'pg';

const expected = {
  products: { product_id: 1043, product_name: 1043, base_unit: 1043, is_active: 16, created_at: 1184 },
  product_units: { product_unit_id: 20, product_id: 1043, unit_name: 1043, conversion_factor: 23, scan_code: 1043, is_base_unit: 16 },
  inventory: { product_id: 1043, quantity_base: 20, updated_at: 1184 },
  stock_transactions: { transaction_id: 2950, product_id: 1043, product_unit_id: 20, scan_point_id: 1043,
    movement_type: 1043, quantity_packages: 23, conversion_factor_snapshot: 23, quantity_base: 20, inventory_after: 20, created_at: 1184 },
  scan_points: { scan_point_id: 1043, point_name: 1043, is_active: 16 },
};

export async function checkPhase2Access(db) {
  const identity = (await db.query(`SELECT current_database() AS database, current_user AS role,
    session_user AS session_role, current_setting('transaction_read_only') AS read_only,
    current_setting('server_version') AS version`)).rows[0];
  if (identity.database !== 'smart_warehouse' || identity.role !== 'warehouse_readonly'
      || identity.session_role !== 'warehouse_readonly' || identity.read_only !== 'on') {
    throw Object.assign(new Error('Application identity or read-only session does not match.'), { code: 'APPLICATION_IDENTITY_MISMATCH' });
  }
  const results = await db.query(readFileSync(new URL('../verify-phase2-readonly.sql', import.meta.url), 'utf8'));
  const privileges = results.at(-1).rows[0];
  if (privileges.phase2_permissions !== 'PASS') {
    throw Object.assign(new Error('Phase 2 database permissions do not match; run manual verification in pgAdmin.'), {
      code: 'PHASE2_ACCESS_DENIED', tables: privileges.tables_needing_review || [],
    });
  }
  // Validate actual name/type and SELECT access without reading data or any users columns.
  for (const [table, fields] of Object.entries(expected)) {
    const result = await db.query(`SELECT ${Object.keys(fields).join(', ')} FROM public.${pg.escapeIdentifier(table)} LIMIT 0`);
    if (result.fields.some((field) => fields[field.name] !== field.dataTypeID)) {
      throw Object.assign(new Error('Schema types do not match the inspected schema.'), { code: 'SCHEMA_MISMATCH' });
    }
  }
  return { identity, permissions: privileges.phase2_permissions, tables: Object.keys(expected) };
}
