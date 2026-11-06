-- NOT EXECUTED. Requires separate read-only Cloud approval and verified endpoint/TLS.
-- Does not read Auth/business rows, hashes, keys or pg_authid.
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT current_database(),current_user,session_user,current_setting('server_version'),
  (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls;
SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolreplication
FROM pg_roles WHERE rolname IN ('postgres','anon','authenticated','service_role','supabase_admin',
 'warehouse_readonly','warehouse_backend','warehouse_stock_executor','warehouse_admin_executor','warehouse_auth_executor');
SELECT r.rolname AS role,u.rolname AS member,g.rolname AS grantor,m.admin_option,m.inherit_option,m.set_option
FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member JOIN pg_roles g ON g.oid=m.grantor
WHERE r.rolname LIKE 'warehouse_%' OR u.rolname LIKE 'warehouse_%';
SELECT n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relacl,c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('users','products','product_units','inventory','stock_transactions','scan_points',
 'warehouse_auth_sessions','warehouse_rate_buckets','users_user_id_seq','product_units_product_unit_id_seq');
SELECT pg_get_userbyid(defaclrole) AS creator,coalesce(n.nspname,'GLOBAL') AS schema,defaclobjtype,defaclacl
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE defaclrole='postgres'::regrole;
SELECT nspname,nspacl FROM pg_namespace WHERE nspname IN ('public','auth');
SELECT datname,datacl FROM pg_database WHERE datname=current_database();
SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull
FROM pg_attribute a WHERE a.attrelid=to_regclass('auth.sessions') AND a.attnum>0 AND NOT a.attisdropped
 AND a.attname IN ('id','user_id','created_at','not_after');
SELECT p.oid::regprocedure,pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND
 p.proname IN ('record_stock_movement','admin_dashboard_write','resolve_cloud_principal','revoke_cloud_session','rate_cloud_request');
ROLLBACK;
