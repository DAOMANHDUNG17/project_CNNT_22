// Start the existing backend only after proving the destination is isolated.
// No DDL, GRANT, role changes, fixtures or Redis ACL changes.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import pg from 'pg';
import { readSecureConfig } from '../../src/config/secure.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const envFile = fileURLToPath(new URL('../../infra/phase3/local/backend.env', import.meta.url));
const env = parseEnv(readFileSync(envFile,'utf8'));
for (const key of ['PGPASSWORD_FILE','WRITE_PGPASSWORD_FILE','REDIS_PASSWORD_FILE']) {
  if (env[key]) env[key] = resolve(root,env[key]);
}
const config = readSecureConfig(env);
if (config.database.host !== '127.0.0.1' || config.database.port !== 5433
  || config.database.database !== 'smart_warehouse_phase3_test' || config.redis.host !== '127.0.0.1'
  || config.redis.port !== 6379 || config.schema !== 'public') throw new Error('Refusing non-test backend configuration.');
const db = new pg.Client(config.database);
try {
  await db.connect();
  const {rows} = await db.query(`SELECT current_database()='smart_warehouse_phase3_test'
    AND current_setting('phase3.environment',true)='isolated-test-v1'
    AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='smart_warehouse') AS safe`);
  if (!rows[0]?.safe) throw new Error('Refusing a cluster that is not isolated test.');
} finally { await db.end(); }
const child = fork(fileURLToPath(new URL('../../src/server.js',import.meta.url)),[],{
  cwd:root,env:{...process.env,...env,APP_ENV_FILE:envFile,PORT:'3000'},stdio:'inherit',windowsHide:true,
});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??1;});
