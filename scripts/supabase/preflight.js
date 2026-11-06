// Read-only diagnostic source only. Requires renewed connection approval before running.
// Requires separately supplied Cloud env; never falls back to local main.
import { writeFileSync } from 'node:fs';
import { loadCloudEnvironment } from '../lib/cloud-environment.js';
import { readCloudConfig } from '../../src/config/cloud.js';
import { createPool } from '../../src/db/pool.js';
import { checkCloudAccess } from '../../src/db/cloud-access.js';

let reader, writer, readClient, writeClient;
const report = { checkedAt: new Date().toISOString(), mode: 'READ ONLY', status: 'NOT CONNECTED' };
try {
  const config = readCloudConfig(loadCloudEnvironment());
  report.projectRef = config.projectRef;
  reader = createPool({ ...config.database, max: 1 });
  writer = createPool({ ...config.writer, max: 1 });
  readClient = await reader.connect();
  writeClient = await writer.connect();
  for (const client of [readClient, writeClient]) {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    const { rows } = await client.query("SELECT current_database() AS database,current_user AS role,session_user,current_setting('transaction_read_only') AS read_only,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls");
    const identity = rows[0];
    if (identity.database !== 'postgres' || identity.read_only !== 'on' || identity.tls !== true
        || !['warehouse_readonly','warehouse_backend'].includes(identity.role) || identity.session_user !== identity.role) throw Object.assign(new Error('Target identity refused.'), { code: 'TARGET_DENIED' });
  }
  report.status = 'CONNECTED READ ONLY; SECURITY CHECK PENDING';
  report.columns = (await readClient.query(`SELECT c.relname AS table,a.attname AS column,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,a.attidentity AS identity,a.attgenerated AS generated
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
    WHERE n.nspname='public' AND c.relname IN ('users','products','product_units','inventory','stock_transactions','scan_points','warehouse_auth_sessions','warehouse_rate_buckets')
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`)).rows;
  report.functions = (await readClient.query(`SELECT n.nspname AS schema,p.proname AS name,oidvectortypes(p.proargtypes) AS arguments,
    pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,p.proconfig AS settings,md5(pg_get_functiondef(p.oid)) AS definition_md5
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE
    (n.nspname='public' AND p.proname IN ('record_stock_movement','admin_dashboard_write','resolve_cloud_principal','revoke_cloud_session','rate_cloud_request'))
    OR (n.nspname='warehouse_private' AND p.proname='provider_session_window')`)).rows;
  await checkCloudAccess(readClient, writeClient);
  report.status = 'READ-ONLY STARTUP POLICY VERIFIED; NOT DEPLOYMENT ACCEPTANCE';
} catch (error) {
  report.failureCode = /^[A-Z0-9_]{2,64}$/u.test(error.code ?? '') ? error.code : 'CONFIGURATION_OR_PREFLIGHT_FAILED';
  console.error(reader ? `Cloud preflight failed: ${report.failureCode}. No migration or business function was executed.` : error.message);
  process.exitCode = 1;
} finally {
  for (const client of [readClient, writeClient]) {
    if (client) { try { await client.query('ROLLBACK'); } catch { /* connection already closed */ } client.release(); }
  }
  await Promise.allSettled([reader?.end(), writer?.end()]);
  if (reader) {
    writeFileSync(new URL('../../docs/SUPABASE_READONLY_REPORT.json', import.meta.url), JSON.stringify(report, null, 2)+'\n');
    console.info('Saved sanitized catalog result to docs/SUPABASE_READONLY_REPORT.json.');
  }
}
