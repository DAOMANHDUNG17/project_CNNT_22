-- NOT EXECUTED. Run only on approved staging after migration/provisioning gates.
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT current_database(),current_user,session_user;
SELECT c.relname,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
 pg_get_expr(d.adbin,d.adrelid) AS default_expression
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname='public' AND c.relname IN ('users','products','product_units','inventory','stock_transactions','scan_points')
 AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum;
SELECT conrelid::regclass,conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN
 ('public.users'::regclass,'public.products'::regclass,'public.product_units'::regclass,'public.inventory'::regclass,'public.stock_transactions'::regclass,'public.scan_points'::regclass);
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN
 ('users','products','product_units','inventory','stock_transactions','scan_points','warehouse_auth_sessions','warehouse_rate_buckets');
SELECT tgrelid::regclass,tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.users'::regclass,'public.products'::regclass);
SELECT p.oid::regprocedure,pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl,md5(pg_get_functiondef(p.oid))
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND
 p.proname IN ('record_stock_movement','admin_dashboard_write','resolve_cloud_principal','revoke_cloud_session','rate_cloud_request');
-- Do not output Auth tokens/passwords/PII or historical actors in logs.
ROLLBACK;
