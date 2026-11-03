export async function checkSecureAccess(reader, writer) {
  for (const [db, expected, readOnly] of [[reader, 'warehouse_readonly', 'on'], [writer, 'warehouse_backend', 'off']]) {
    const identity = (await db.query(`SELECT current_user AS role,session_user,current_database() AS database,
      current_setting('default_transaction_read_only') AS read_only`)).rows[0];
    if (identity.role !== expected || identity.session_user !== expected || identity.read_only !== readOnly) {
      throw Object.assign(new Error('Runtime database identity is invalid.'), { code: 'RUNTIME_ACCESS_DENIED' });
    }
    const unsafe = (await db.query(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication))
      OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user))
      OR has_schema_privilege('public','CREATE') OR has_database_privilege(current_database(),'CREATE')
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
        AND CASE WHEN c.relkind IN ('r','p') THEN (has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')
          OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES')) ELSE false END) AS unsafe`)).rows[0].unsafe;
    if (unsafe) throw Object.assign(new Error('Runtime privileges exceed policy.'), { code: 'RUNTIME_ACCESS_DENIED' });
  }
  const functions = (await writer.query(`SELECT p.proname,p.prosecdef,pg_get_userbyid(p.proowner) AS owner,p.proconfig,
    has_function_privilege(p.oid,'EXECUTE') AS allowed,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
      WHERE x.grantee=0 AND x.privilege_type='EXECUTE') AS public_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('record_stock_movement','admin_dashboard_write')`)).rows;
  if (functions.length !== 2 || functions.some(f => !f.prosecdef || !f.allowed || f.public_execute
    || !['warehouse_stock_executor', 'warehouse_admin_executor'].includes(f.owner)
    || f.proconfig?.[0] !== 'search_path=pg_catalog, public, pg_temp')) {
    throw Object.assign(new Error('Hardened database functions are unavailable.'), { code: 'RUNTIME_ACCESS_DENIED' });
  }
  await writer.query('SELECT user_id,username,display_name,role,password_hash,is_active,auth_version,created_at FROM public.users LIMIT 0');
}
