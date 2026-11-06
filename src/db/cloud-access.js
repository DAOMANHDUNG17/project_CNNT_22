import { assertCloudColumns } from './cloud-column-policy.js';
import { checkProviderBridge } from './cloud-provider-bridge.js';
const roles = ['warehouse_readonly', 'warehouse_backend', 'warehouse_stock_executor', 'warehouse_admin_executor', 'warehouse_auth_executor'];
export const cloudFunctions = Object.freeze({
  'record_stock_movement(uuid,bigint,character varying,character varying,character varying,integer)': 'warehouse_stock_executor',
  'admin_dashboard_write(bigint,text,jsonb)': 'warehouse_admin_executor',
  'resolve_cloud_principal(uuid,uuid)': 'warehouse_auth_executor',
  'revoke_cloud_session(uuid,bigint)': 'warehouse_auth_executor',
  'rate_cloud_request(text,text)': 'warehouse_auth_executor',
});
const reject = () => { throw Object.assign(new Error('Cloud database privileges do not match the reviewed policy.'), { code: 'CLOUD_ACCESS_DENIED' }); };

// Kept separate from the stricter local checker. Only D4's two explicit managed
// compatibility exceptions are permitted; neither is a blanket bypass.
export function assertCloudCatalog(catalog) {
  if (catalog.roles.length !== 5 || roles.some(name => !catalog.roles.some(r => r.rolname === name))) reject();
  for (const role of catalog.roles) {
    if (role.rolcanlogin !== roles.slice(0, 2).includes(role.rolname)
        || ['rolinherit', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls'].some(key => role[key] !== false)) reject();
  }
  for (const m of catalog.memberships) {
    if (!roles.includes(m.role) || m.member !== 'postgres' || m.grantor !== 'supabase_admin'
        || m.admin_option !== true || m.inherit_option !== false || m.set_option !== false) reject();
  }
  if (catalog.functions.length !== 5 || catalog.functions.some(f =>
    cloudFunctions[f.signature] !== f.owner || f.prosecdef !== true || f.allowed !== true || f.unsafe_execute !== false
    || JSON.stringify(f.proconfig) !== JSON.stringify(['search_path=pg_catalog, public, pg_temp']))) reject();
  if (new Set(catalog.functions.map(f => f.signature)).size !== 5) reject();
  if (Object.values(catalog.checks).some(value => value !== false) || Object.keys(catalog.checks).length !== 7) reject();
}

export async function checkCloudAccess(reader, writer) {
  for (const [db, role, mode] of [[reader, roles[0], 'on'], [writer, roles[1], 'off']]) {
    const row = (await db.query(`SELECT current_user AS role,session_user,current_database() AS database,
      current_setting('default_transaction_read_only') AS read_only,
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`)).rows[0];
    if (!row || row.role !== role || row.session_user !== role || row.database !== 'postgres' || row.read_only !== mode || row.tls !== true) reject();
    const unsafe = (await db.query(`SELECT
      has_database_privilege(current_database(),'CREATE')
      OR EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND has_schema_privilege(n.oid,'CREATE'))
      OR EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
        WHERE d.datname=current_database() AND a.privilege_type='TEMPORARY' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname=current_user))
      OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth')
        AND CASE WHEN c.relkind IN ('r','p') THEN has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN,SELECT WITH GRANT OPTION')
          OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION')
          OR (n.nspname='auth' AND has_any_column_privilege(c.oid,'SELECT'))
        WHEN c.relkind='S' THEN has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE')
        WHEN c.relkind IN ('v','m','f') THEN has_any_column_privilege(c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END)
      AS unsafe`)).rows[0];
    if (unsafe?.unsafe !== false) reject();
  }
  const roleRows = (await writer.query(`SELECT rolname,rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
    FROM pg_roles WHERE rolname=ANY($1::text[])`, [roles])).rows;
  const memberships = (await writer.query(`SELECT r.rolname AS role,u.rolname AS member,g.rolname AS grantor,
    m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m
    JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member JOIN pg_roles g ON g.oid=m.grantor
    WHERE r.rolname=ANY($1::text[]) OR u.rolname=ANY($1::text[])`, [roles])).rows;
  const functions = (await writer.query(`SELECT p.proname||'('||oidvectortypes(p.proargtypes)||')' AS signature,
    p.prosecdef,pg_get_userbyid(p.proowner) AS owner,p.proconfig,has_function_privilege(p.oid,'EXECUTE') AS allowed,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
      WHERE x.privilege_type='EXECUTE' AND (x.grantee NOT IN (p.proowner,(SELECT oid FROM pg_roles WHERE rolname='warehouse_backend')) OR x.is_grantable)) AS unsafe_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=ANY($1::text[])`, [Object.keys(cloudFunctions).map(s => s.split('(')[0])])).rows
    .map(f => ({ ...f, signature: f.signature.replace(/, /gu, ',') }));
  const checks = (await writer.query(`SELECT
    (SELECT count(*)<>8 OR bool_or(pg_get_userbyid(c.relowner)<>'postgres') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND c.relkind='r') AS ownership,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN (SELECT oid,rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) r
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND
      (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) AS api_exposure,
    EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname=ANY($2::text[])
      AND has_column_privilege(r.oid,'public.users','password_hash','SELECT,INSERT,UPDATE')) AS password_access,
    has_any_column_privilege('warehouse_readonly','public.users','SELECT')
      OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
        AND p.prosecdef AND has_function_privilege('warehouse_readonly',p.oid,'EXECUTE')) AS reader_isolation,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN
      (SELECT oid FROM pg_roles WHERE rolname IN ('warehouse_readonly','warehouse_backend','warehouse_stock_executor','warehouse_admin_executor','warehouse_auth_executor','anon','authenticated','service_role')) r
      WHERE n.nspname='public' AND c.relkind='S' AND has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')) AS sequence_access,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND (a.grantee=0 OR a.is_grantable AND a.grantee<>c.relowner)) AS public_grants,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.prosecdef AND p.proname<>ALL($3::text[]) AND has_function_privilege('warehouse_backend',p.oid,'EXECUTE')) AS unexpected_definer`,
  [['users','products','product_units','inventory','stock_transactions','scan_points','warehouse_auth_sessions','warehouse_rate_buckets'],
    roles, Object.keys(cloudFunctions).map(s => s.split('(')[0])])).rows[0];
  if (!checks) reject();
  assertCloudCatalog({ roles: roleRows, memberships, functions, checks });
  const columns = (await writer.query(`SELECT r.rolname AS role,c.relname AS table,a.attname AS column,
    has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') AS select,
    has_column_privilege(r.oid,c.oid,a.attnum,'INSERT') AS insert,
    has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE') AS update,
    has_column_privilege(r.oid,c.oid,a.attnum,'REFERENCES') AS references,
    has_table_privilege(r.oid,c.oid,'DELETE') AS delete,
    has_table_privilege(r.oid,c.oid,'TRUNCATE,TRIGGER,MAINTAIN') AS dangerous,
    (has_column_privilege(r.oid,c.oid,a.attnum,'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,REFERENCES WITH GRANT OPTION')
      OR has_table_privilege(r.oid,c.oid,'DELETE WITH GRANT OPTION')) AS grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    CROSS JOIN (SELECT oid,rolname FROM pg_roles WHERE rolname=ANY($1::text[])) r
    WHERE n.nspname='public' AND c.relkind IN ('r','p') AND (r.rolname LIKE 'warehouse_%' OR c.relname=ANY($2::text[]))`,
  [[...roles,'anon','authenticated','service_role'], ['users','products','product_units','inventory','stock_transactions','scan_points','warehouse_auth_sessions','warehouse_rate_buckets']])).rows;
  assertCloudColumns(columns);
  await checkProviderBridge(writer);
  // Positive projections: a denied/missing grant must also refuse startup.
  await reader.query('SELECT product_id,quantity_base FROM public.inventory LIMIT 0');
  await writer.query('SELECT user_id,username,display_name,role,is_active,auth_version,created_at FROM public.users LIMIT 0');
}
