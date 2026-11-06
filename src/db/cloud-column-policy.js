const policy = {
  warehouse_readonly: Object.fromEntries(['products','product_units','inventory','stock_transactions','scan_points'].map(t => [t, { select: '*' }])),
  warehouse_backend: {
    users: { select: 'user_id username display_name role is_active created_at auth_version' },
    stock_transactions: { select: 'transaction_id product_id product_unit_id scan_point_id movement_type quantity_packages conversion_factor_snapshot quantity_base inventory_after created_at' },
  },
  warehouse_stock_executor: {
    users: { select: 'user_id role is_active' }, products: { select: 'product_id is_active' },
    product_units: { select: 'product_id product_unit_id scan_code conversion_factor' }, scan_points: { select: 'scan_point_id is_active' },
    inventory: { select: 'product_id quantity_base', update: 'quantity_base updated_at' },
    stock_transactions: { select: 'transaction_id user_id scan_point_id movement_type quantity_packages request_scan_code inventory_after',
      insert: 'transaction_id product_id product_unit_id scan_point_id user_id movement_type quantity_packages conversion_factor_snapshot inventory_after request_scan_code', update: 'inventory_after' },
  },
  warehouse_admin_executor: {
    users: { select: 'user_id username display_name role is_active created_at auth_version', update: 'username display_name role is_active auth_version' },
    products: { select: '*', insert: 'product_id product_name base_unit is_active', update: 'product_name base_unit is_active' },
    product_units: { select: '*', insert: 'product_id unit_name conversion_factor scan_code is_base_unit', update: 'unit_name' },
    scan_points: { select: '*', insert: '*', update: 'point_name is_active' },
    inventory: { select: 'product_id quantity_base', insert: 'product_id' }, stock_transactions: { select: 'product_id' },
  },
  warehouse_auth_executor: {
    users: { select: 'user_id username display_name role is_active auth_version auth_user_id auth_state auth_reauth_after' },
    warehouse_auth_sessions: { select: '*', insert: 'session_id user_id auth_version issued_at last_seen_at expires_at', update: 'last_seen_at revoked_at', delete: true },
    warehouse_rate_buckets: { select: '*', insert: '*', update: 'window_start requests expires_at', delete: true },
  },
};
export function assertCloudColumns(rows) {
  if (!rows.length) throw new Error('Cloud privilege catalog is empty.');
  for (const row of rows) {
    const rule = policy[row.role]?.[row.table] ?? {};
    for (const action of ['select','insert','update','references']) {
      const allowed = rule[action] === '*' || typeof rule[action] === 'string' && rule[action].split(' ').includes(row.column);
      if (row[action] !== Boolean(allowed)) throw new Error('Cloud column privileges differ from the reviewed matrix.');
    }
    if (row.delete !== Boolean(rule.delete) || row.dangerous !== false || row.grantable !== false) throw new Error('Cloud object privileges exceed the reviewed matrix.');
  }
}
