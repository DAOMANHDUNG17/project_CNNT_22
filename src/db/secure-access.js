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
      OR has_schema_privilege('public','CREATE') OR has_database_privilege(current_database(),'CREATE,TEMP')
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
        AND CASE WHEN c.relkind IN ('r','p') THEN (has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,MAINTAIN,SELECT WITH GRANT OPTION')
          OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION'))
          WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE') ELSE false END) AS unsafe`)).rows[0].unsafe;
    if (unsafe) throw Object.assign(new Error('Runtime privileges exceed policy.'), { code: 'RUNTIME_ACCESS_DENIED' });
  }
  const executors = (await writer.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS membership
    FROM pg_roles r WHERE rolname IN ('warehouse_stock_executor','warehouse_admin_executor')`)).rows;
  if (executors.length !== 2 || executors.some(r => ['rolcanlogin','rolinherit','rolsuper','rolcreatedb',
    'rolcreaterole','rolreplication','rolbypassrls','membership'].some(key => r[key]))) {
    throw Object.assign(new Error('Executor roles exceed policy.'), { code: 'RUNTIME_ACCESS_DENIED' });
  }
  const readerAccess = (await reader.query(`SELECT has_any_column_privilege('public.users','SELECT')
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('record_stock_movement','admin_dashboard_write')
      AND has_function_privilege(p.oid,'EXECUTE')) AS unsafe`)).rows[0].unsafe;
  if (readerAccess) throw Object.assign(new Error('Reader isolation is invalid.'), { code: 'RUNTIME_ACCESS_DENIED' });
  const functions = (await writer.query(`SELECT p.proname,p.prosecdef,pg_get_userbyid(p.proowner) AS owner,p.proconfig,
    has_function_privilege(p.oid,'EXECUTE') AS allowed,
    p.oid IN (to_regprocedure('public.record_stock_movement(uuid,bigint,character varying,character varying,character varying,integer)'),
      to_regprocedure('public.admin_dashboard_write(bigint,text,jsonb)')) AS expected_signature,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
      WHERE x.privilege_type='EXECUTE' AND (x.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='warehouse_backend'))
        OR x.is_grantable)) AS unsafe_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('record_stock_movement','admin_dashboard_write')`)).rows;
  const owners = { record_stock_movement: 'warehouse_stock_executor', admin_dashboard_write: 'warehouse_admin_executor' };
  if (functions.length !== 2 || functions.some(f => !f.prosecdef || !f.allowed || !f.expected_signature || f.unsafe_execute
    || f.owner !== owners[f.proname]
    || JSON.stringify(f.proconfig) !== JSON.stringify(['search_path=pg_catalog, public, pg_temp']))) {
    throw Object.assign(new Error('Hardened database functions are unavailable.'), { code: 'RUNTIME_ACCESS_DENIED' });
  }
  await writer.query('SELECT user_id,username,display_name,role,password_hash,is_active,auth_version,created_at FROM public.users LIMIT 0');
}
