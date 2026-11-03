-- Safe catalog inspection only. Does not read users rows or call business functions.
BEGIN READ ONLY;
SELECT current_database() AS database,current_user AS role,
       current_setting('server_version') AS version,current_setting('transaction_read_only') AS read_only;
SELECT a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,
       has_column_privilege(c.oid,a.attnum,'SELECT') AS can_select
FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='users' AND a.attnum>0 AND NOT a.attisdropped
ORDER BY a.attnum;
SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
WHERE conrelid=to_regclass('public.users');
SELECT p.oid::regprocedure::text AS signature,pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef,p.proconfig,p.proacl::text,
       has_function_privilege(p.oid,'EXECUTE') AS can_execute,
       md5(pg_get_functiondef(p.oid)) AS function_definition_checksum
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='record_stock_movement';
SELECT datname FROM pg_database WHERE datname IN ('smart_warehouse','smart_warehouse_phase3_test');
SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolbypassrls
FROM pg_roles WHERE rolname IN ('warehouse_readonly','warehouse_backend','warehouse_stock_executor');
ROLLBACK;
