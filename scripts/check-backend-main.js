// Catalog inspection only: no users rows, DDL, business function calls or grants.
import { writeFileSync } from 'node:fs';
import { readConfig } from '../src/config/env.js';
import { createPool } from '../src/db/pool.js';

const config = readConfig();
if (config.database.database !== 'smart_warehouse' || config.database.user !== 'warehouse_readonly'
    || config.schema !== 'public') throw new Error('Main inspection requires the main read-only configuration.');
const pool = createPool(config.database);
const report = { inspectedAt: new Date().toISOString(), mode: 'BEGIN READ ONLY; catalog queries only', checks: {} };
try {
  const db = await pool.connect();
  try {
    await db.query('BEGIN READ ONLY');
    report.identity = (await db.query(`SELECT current_database() AS database,current_user AS role,
      current_setting('transaction_read_only') AS read_only,current_setting('server_version') AS version`)).rows[0];
    report.columns = (await db.query(`SELECT c.relname AS table_name,a.attname AS column_name,
      format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) AS default_expression
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname,a.attnum`)).rows;
    report.roles = (await db.query(`SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,
      rolinherit,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN
      ('warehouse_readonly','warehouse_backend','warehouse_stock_executor','warehouse_admin_executor') ORDER BY rolname`)).rows;
    report.memberships = (await db.query(`SELECT r.rolname AS member,p.rolname AS parent,m.admin_option
      FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member JOIN pg_roles p ON p.oid=m.roleid
      WHERE r.rolname LIKE 'warehouse_%' OR p.rolname LIKE 'warehouse_%' ORDER BY 1,2`)).rows;
    report.functions = (await db.query(`SELECT p.oid::regprocedure::text AS signature,p.proname,
      pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,p.proacl::text,
      md5(pg_get_functiondef(p.oid)) AS definition_md5,
      p.oid IN (to_regprocedure('public.record_stock_movement(uuid,bigint,character varying,character varying,character varying,integer)'),
        to_regprocedure('public.admin_dashboard_write(bigint,text,jsonb)')) AS expected_signature,
      EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
        WHERE x.grantee=0 AND x.privilege_type='EXECUTE') AS public_execute,
      EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
        WHERE x.privilege_type='EXECUTE' AND (x.is_grantable OR
          (x.grantee<>p.proowner AND x.grantee IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname='warehouse_backend')))) AS unsafe_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN ('record_stock_movement','admin_dashboard_write') AND p.prokind='f' ORDER BY 1`)).rows;
    report.acl = (await db.query(`SELECT r.rolname,c.relname,a.attname,
      has_column_privilege(r.oid,c.oid,a.attnum,'SELECT') AS can_select,
      has_column_privilege(r.oid,c.oid,a.attnum,'INSERT') AS can_insert,
      has_column_privilege(r.oid,c.oid,a.attnum,'UPDATE') AS can_update,
      has_table_privilege(r.oid,c.oid,'DELETE,TRUNCATE,TRIGGER,MAINTAIN') AS destructive,
      has_schema_privilege(r.oid,n.oid,'CREATE') AS schema_create,
      has_database_privilege(r.oid,current_database(),'CREATE,TEMP') AS database_create_or_temp
      FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      WHERE r.rolname IN ('warehouse_readonly','warehouse_backend','warehouse_stock_executor','warehouse_admin_executor')
      AND n.nspname='public' AND c.relkind IN ('r','p') ORDER BY r.rolname,c.relname,a.attnum`)).rows;
    report.functionAcl = (await db.query(`SELECT r.rolname,p.oid::regprocedure::text AS signature,
      has_function_privilege(r.oid,p.oid,'EXECUTE') AS can_execute
      FROM pg_roles r CROSS JOIN pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE r.rolname IN ('warehouse_readonly','warehouse_backend') AND n.nspname='public'
      AND p.proname IN ('record_stock_movement','admin_dashboard_write') ORDER BY 1,2`)).rows;
    const hasColumn = (table, column) => report.columns.some(c => c.table_name === table && c.column_name === column);
    report.checks.sixTables = ['products','product_units','inventory','stock_transactions','scan_points','users']
      .every(table => report.columns.some(c => c.table_name === table));
    report.checks.authVersion = hasColumn('users', 'auth_version');
    report.checks.requestScanCode = hasColumn('stock_transactions', 'request_scan_code');
    report.checks.runtimeRoles = report.roles.length === 4;
    report.checks.rolePolicy = report.checks.runtimeRoles && report.memberships.length === 0
      && report.roles.every(r => !r.rolsuper && !r.rolcreatedb && !r.rolcreaterole && !r.rolreplication && !r.rolbypassrls
        && (r.rolname.endsWith('_executor') ? !r.rolcanlogin && !r.rolinherit : r.rolcanlogin));
    report.checks.hardenedFunctions = ['record_stock_movement','admin_dashboard_write'].every(name =>
      report.functions.some(f => f.proname === name && f.expected_signature && f.prosecdef && !f.public_execute && !f.unsafe_execute
        && f.owner === (name === 'record_stock_movement' ? 'warehouse_stock_executor' : 'warehouse_admin_executor')
        && JSON.stringify(f.proconfig) === JSON.stringify(['search_path=pg_catalog, public, pg_temp'])));
    report.checks.readerIsolation = !report.functionAcl.some(a => a.rolname === 'warehouse_readonly' && a.can_execute)
      && !report.acl.some(a => a.rolname === 'warehouse_readonly' && a.relname === 'users' && a.can_select);
    report.checks.runtimeAcl = report.checks.runtimeRoles
      && !report.acl.some(a => ['warehouse_readonly','warehouse_backend'].includes(a.rolname)
        && (a.can_insert || a.can_update || a.destructive || a.schema_create || a.database_create_or_temp))
      && ['user_id','username','display_name','role','password_hash','is_active','auth_version','created_at']
        .every(column => report.acl.some(a => a.rolname === 'warehouse_backend' && a.relname === 'users' && a.attname === column && a.can_select))
      && report.functionAcl.filter(a => a.rolname === 'warehouse_backend' && a.can_execute).length === 2;
    report.result = Object.values(report.checks).every(Boolean) ? 'PASS' : 'FAIL';
  } finally { await db.query('ROLLBACK'); db.release(); }
  writeFileSync(new URL('../docs/backend-main-inspection.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.info(JSON.stringify({ result: report.result, identity: report.identity, checks: report.checks,
    roles: report.roles.map(r => r.rolname), functions: report.functions }, null, 2));
  if (report.result !== 'PASS') process.exitCode = 1;
} catch (error) {
  console.error({ result: 'FAIL', code: error.code || 'MAIN_INSPECTION_FAILED' });
  process.exitCode = 1;
} finally { await pool.end(); }
