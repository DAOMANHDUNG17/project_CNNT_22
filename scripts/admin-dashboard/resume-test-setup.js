// Resume a failed fresh bootstrap at an explicit reviewed file; no reset/drop.
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { hashPassword } from '../../src/auth/passwords.js';
const secret = name => readFileSync(resolve('infra/phase3/local', name), 'utf8');
const config = { host: '127.0.0.1', port: 5433, user: 'postgres', database: 'smart_warehouse_phase3_test', password: secret('postgres-admin-password.txt') };
const db = new pg.Client(config);
await db.connect();
try {
  const safe = (await db.query("SELECT current_database()='smart_warehouse_phase3_test' AND current_setting('phase3.environment',true)='isolated-test-v1' AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='smart_warehouse') AS safe")).rows[0].safe;
  if (!safe) throw new Error('Wrong cluster.');
  const files = ['scripts/phase3/40-hardening-test.psql','scripts/phase3/50-verify-hardening-readonly.psql',
    'scripts/admin-dashboard/10-admin-test.psql','scripts/admin-dashboard/20-verify-admin-readonly.psql'];
  for (const file of (process.argv.includes('--admin-only') ? files.slice(2) : files)) {
    const result = spawnSync('C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe', ['-X','-h','127.0.0.1','-p','5433','-U','postgres','-d',config.database,'-v','ON_ERROR_STOP=1','-f',resolve(file)],
      { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } });
    if (result.status !== 0) { console.error(JSON.stringify({file,status:'FAIL',errors:(result.stderr||'').split(/\r?\n/).filter(line=>/ERROR:/.test(line))})); process.exitCode=1; break; }
    console.info(JSON.stringify({file,status:'PASS'}));
  }
  if (!process.exitCode) {
    for(const [role,file] of [['warehouse_readonly','reader-password.txt'],['warehouse_backend','backend-password.txt']]) {
      const state=(await db.query('SELECT rolcanlogin FROM pg_roles WHERE rolname=$1',[role])).rows[0];
      if(state?.rolcanlogin) throw new Error('Refuse to overwrite existing runtime credentials.');
      await db.query(`ALTER ROLE ${pg.escapeIdentifier(role)} PASSWORD ${pg.escapeLiteral(secret(file))} LOGIN`);
    }
    for(const name of ['admin','keeper','staff','viewer','inactive']) {
      const username=`p3_${name}`;
      const hash=await hashPassword(secret(`${username}-password.txt`));
      if((await db.query('UPDATE public.users SET password_hash=$1 WHERE username=$2 AND password_hash IS NULL',[hash,username])).rowCount!==1) throw new Error('Refuse to overwrite an existing account hash.');
    }
    console.info('Test credential provisioning PASS; no secret values printed.');
  }
} catch(e) {console.error(JSON.stringify({status:'FAIL',code:e.code||'TEST_RESUME_FAILED'}));process.exitCode=1;}
finally{await db.end();}
