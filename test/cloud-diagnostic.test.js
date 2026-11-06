import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readCloudDiagnosticConfig, readCloudConfig } from '../src/config/cloud.js';
import { inspectCloudCatalog, catalogQueries } from '../src/cloud/catalog-inspection.js';
const ref='abcdefghijklmnopqrst';
const ca='-----BEGIN CERTIFICATE-----\nSYNTHETIC-CONFIG-ONLY\n-----END CERTIFICATE-----';
const env=()=>({APP_PROFILE:'supabase-cloud',CLOUD_DIAGNOSTIC_ONLY:'1',SUPABASE_PROJECT_REF:ref,SUPABASE_EXPECTED_PROJECT_REF:ref,
  SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_DB_MODE:'direct',PGHOST:`db.${ref}.supabase.co`,PGDATABASE:'postgres',PGUSER:'postgres',
  PGPASSWORD:'synthetic-password-@:#',PGSSLROOTCERT:'synthetic-ca'});

test('admin diagnostic accepts only its dedicated profile with verified TLS and forced read-only sessions', () => {
  const config=readCloudDiagnosticConfig(env(),{readFile:()=>ca});
  assert.equal(config.database.user,'postgres');
  assert.equal(config.database.options,'-c default_transaction_read_only=on');
  assert.equal(config.database.ssl.rejectUnauthorized,true);
  assert.equal(config.database.password,'synthetic-password-@:#');
  assert.equal(config.frontend,undefined);
  assert.throws(()=>readCloudConfig(env(),{readFile:()=>ca}),/diagnostic/);
  for(const patch of [{CLOUD_DIAGNOSTIC_ONLY:undefined},{PGUSER:'warehouse_backend'},{PGDATABASE:'smart_warehouse'},
    {PGHOST:'127.0.0.1'},{PGSSLMODE:'no-verify'},{NODE_TLS_REJECT_UNAUTHORIZED:'0'},{PGPORT:'6543'},
    {SUPABASE_EXPECTED_PROJECT_REF:'wrong'},{PGQUERY_TIMEOUT_MS:'30000'}]) {
    assert.throws(()=>readCloudDiagnosticConfig({...env(),...patch},{readFile:()=>ca}));
  }
  assert.equal(readCloudDiagnosticConfig({...env(),SUPABASE_DB_MODE:'session',PGHOST:'aws-0-example.pooler.supabase.com'},{readFile:()=>ca}).database.user,`postgres.${ref}`);
});

test('catalog diagnostic executes only fixed SELECTs under READ ONLY and rolls back on success or failure', async () => {
  const identity={database:'postgres',role:'postgres',session_user:'postgres',read_only:'on',tls:true,version:'17.11'};
  for(const fail of [false,true]) {
    const calls=[];
    const client={async query(sql){calls.push(sql);if(sql.includes('current_database()'))return {rows:[identity]};
      if(fail&&sql===catalogQueries[0][1])throw new Error('synthetic error');return {rows:[]};}};
    if(fail)await assert.rejects(inspectCloudCatalog(client));
    else assert.equal((await inspectCloudCatalog(client)).status,'CATALOG INVENTORY ONLY; NOT SECURITY ACCEPTANCE');
    assert.equal(calls[0],'BEGIN READ ONLY');assert.equal(calls.at(-1),'ROLLBACK');
    assert.ok(calls.slice(1,-1).every(sql=>sql.startsWith('SELECT ')));
    for(const sql of calls) assert.doesNotMatch(sql,/\bFROM\s+(?:public|auth)\.|\b(?:INSERT|DELETE|UPDATE|CREATE|ALTER|DROP|GRANT|COMMIT|pg_authid)\b/iu);
  }
  const calls=[];
  await assert.rejects(inspectCloudCatalog({async query(sql){calls.push(sql);return {rows:[{...identity,read_only:'off'}]};}}),{code:'DIAGNOSTIC_TARGET_DENIED'});
  assert.equal(calls.length,3);assert.equal(calls.at(-1),'ROLLBACK');
});

test('default admin diagnostic CLI validates synthetic files offline without loading a connection', t => {
  const dir=mkdtempSync(join(tmpdir(),'warehouse-cloud-config-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const cert=join(dir,'ca.pem');writeFileSync(cert,ca);
  const path=join(dir,'diagnostic.env');
  writeFileSync(path,Object.entries({...env(),PGSSLROOTCERT:cert}).map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('\n'));
  const result=spawnSync(process.execPath,['scripts/supabase/inspect-schema.js'],{env:{...process.env,APP_ENV_FILE:path},encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/No driver loaded or connection opened/);
  assert.ok(!result.stdout.includes('synthetic-password'));
});
