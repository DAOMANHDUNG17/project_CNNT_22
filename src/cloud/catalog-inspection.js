const businessTables = ['users','products','product_units','inventory','stock_transactions','scan_points','warehouse_auth_sessions','warehouse_rate_buckets'];
const warehouseRoles = ['warehouse_readonly','warehouse_backend','warehouse_stock_executor','warehouse_admin_executor','warehouse_auth_executor'];
export const catalogQueries = Object.freeze([
  ['columns', `SELECT c.relname AS table,a.attname AS column,format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated,a.attacl::text AS column_acl,pg_get_userbyid(c.relowner) AS owner
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,a.attnum`, [businessTables]],
  ['constraints', `SELECT c.relname AS table,k.conname AS name,k.contype AS type,k.convalidated AS validated,
    md5(pg_get_constraintdef(k.oid)) AS definition_md5 FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname`, [businessTables]],
  ['indexes', `SELECT t.relname AS table,i.relname AS name,x.indisunique AS unique,x.indisvalid AS valid,
    md5(pg_get_indexdef(i.oid)) AS definition_md5 FROM pg_catalog.pg_index x
    JOIN pg_catalog.pg_class t ON t.oid=x.indrelid JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY t.relname,i.relname`, [businessTables]],
  ['roles', `SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
    FROM pg_catalog.pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname`, [warehouseRoles]],
  ['memberships', `SELECT r.rolname AS role,u.rolname AS member,g.rolname AS grantor,
    m.admin_option,m.inherit_option,m.set_option FROM pg_catalog.pg_auth_members m
    JOIN pg_catalog.pg_roles r ON r.oid=m.roleid JOIN pg_catalog.pg_roles u ON u.oid=m.member JOIN pg_catalog.pg_roles g ON g.oid=m.grantor
    WHERE r.rolname=ANY($1::text[]) OR u.rolname=ANY($1::text[])`, [warehouseRoles]],
  ['functions', `SELECT n.nspname AS schema,p.proname AS name,oidvectortypes(p.proargtypes) AS arguments,
    pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,
    ARRAY(SELECT split_part(v,'=',1) FROM unnest(p.proconfig) v) AS setting_names,
    p.proacl::text AS acl,md5(pg_get_functiondef(p.oid)) AS definition_md5
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='public' AND p.proname IN ('record_stock_movement','admin_dashboard_write','resolve_cloud_principal','revoke_cloud_session','rate_cloud_request','advance_cloud_auth_cutoff','create_inventory_for_product'))
    OR (n.nspname='warehouse_private' AND p.proname='provider_session_window')`, []],
  ['default_privileges', `SELECT pg_get_userbyid(d.defaclrole) AS creator,coalesce(n.nspname,'GLOBAL') AS schema,d.defaclobjtype AS object_type,d.defaclacl::text AS acl
    FROM pg_catalog.pg_default_acl d LEFT JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
    WHERE pg_get_userbyid(d.defaclrole)='postgres'`, []],
  ['object_privileges', `SELECT c.relname AS object,c.relkind AS kind,c.relacl::text AS acl,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND (c.relname=ANY($1::text[]) OR c.relname IN ('users_user_id_seq','product_units_product_unit_id_seq'))`, [businessTables]],
  ['schemas', `SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl::text AS acl FROM pg_catalog.pg_namespace WHERE nspname IN ('public','auth','warehouse_private')`, []],
  ['database_privileges', `SELECT datname,datacl::text AS acl FROM pg_catalog.pg_database WHERE datname=current_database()`, []],
  ['auth_session_columns', `SELECT a.attname AS column,format_type(a.atttypid,a.atttypmod) AS type
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='auth' AND c.relname='sessions' AND a.attnum>0 AND NOT a.attisdropped
    AND a.attname IN ('id','user_id','created_at','not_after')`, []],
]);

export async function inspectCloudCatalog(client) {
  let began = false;
  try {
    await client.query('BEGIN READ ONLY'); began = true;
    const identity = (await client.query(`SELECT current_database() AS database,current_user AS role,session_user,
      current_setting('transaction_read_only') AS read_only,current_setting('server_version') AS version,
      (SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`)).rows[0];
    if (!identity || identity.database !== 'postgres' || identity.role !== 'postgres' || identity.session_user !== 'postgres'
      || identity.read_only !== 'on' || identity.tls !== true) throw Object.assign(new Error('Diagnostic target refused.'), { code: 'DIAGNOSTIC_TARGET_DENIED' });
    const report = { status: 'CATALOG INVENTORY ONLY; NOT SECURITY ACCEPTANCE', identity };
    for (const [name, sql, parameters] of catalogQueries) report[name] = (await client.query(sql, parameters)).rows;
    return report;
  } finally {
    if (began) await client.query('ROLLBACK');
  }
}
