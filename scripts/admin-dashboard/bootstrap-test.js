// Explicit, guarded test-only DDL and credential provisioning. Never targets 5432.
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hashPassword, verifyPassword } from '../../src/auth/passwords.js';

const database = 'smart_warehouse_phase3_test';
const secret = name => readFileSync(resolve('infra/phase3/local', name), 'utf8');
const config = { host: '127.0.0.1', port: 5433, user: 'postgres', password: secret('postgres-admin-password.txt'),
  database: 'postgres', connectionTimeoutMillis: 5000, application_name: 'isolated_test_bootstrap' };
const probe = new pg.Client(config);
await probe.connect();
if ((await probe.query("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname='smart_warehouse') AS unsafe")).rows[0].unsafe) {
  await probe.end(); throw new Error('Refusing a cluster containing the main database.');
}
const exists = (await probe.query('SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS present', [database])).rows[0].present;
await probe.end();
if (exists) throw new Error('Test DB already exists. Inspect it; this bootstrap never resets or overwrites a database.');
const cli = 'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe';
const steps = [
  ['scripts/phase3/10-bootstrap-isolated-cluster.psql', 'postgres'],
  ...['20-create-test-schema','21-reference-function','30-test-fixtures','40-hardening-test','50-verify-hardening-readonly']
    .map(name => [`scripts/phase3/${name}.psql`, database]),
  ['scripts/admin-dashboard/10-admin-test.psql', database],
  ['scripts/admin-dashboard/20-verify-admin-readonly.psql', database],
];
for (const [file, target] of steps) {
  const result = spawnSync(cli, ['-X', '-h', config.host, '-p', '5433', '-U', 'postgres', '-d', target,
    '-v', 'ON_ERROR_STOP=1', '-v', 'phase3_approval=approved-isolated-phase3', '-f', resolve(file)],
  { encoding: 'utf8', env: { ...process.env, PGPASSWORD: config.password } });
  if (result.status !== 0) {
    // These migration files contain no credentials. Print ERROR lines only, not SQL/context/values.
    console.error(JSON.stringify({ file, status: 'FAIL', errors: (result.stderr || '').split(/\r?\n/).filter(line => /ERROR:/.test(line)) }));
    process.exit(1);
  }
  console.info(JSON.stringify({ file, status: 'PASS' }));
}
const db = new pg.Client({ ...config, database });
try {
  await db.connect();
  if ((await db.query("SELECT current_database()=$1 AND current_setting('phase3.environment',true)='isolated-test-v1' AS safe", [database])).rows[0].safe !== true) {
    throw new Error('Wrong test identity.');
  }
  for (const [role, file] of [['warehouse_readonly', 'reader-password.txt'], ['warehouse_backend', 'backend-password.txt']]) {
    const state = (await db.query('SELECT rolcanlogin,rolsuper FROM pg_roles WHERE rolname=$1', [role])).rows[0];
    if (!state || state.rolcanlogin || state.rolsuper) throw new Error('Unexpected initial runtime role state.');
    await db.query(`ALTER ROLE ${pg.escapeIdentifier(role)} PASSWORD ${pg.escapeLiteral(secret(file))} LOGIN`);
  }
  for (const name of ['admin', 'keeper', 'staff', 'viewer', 'inactive']) {
    const username = `p3_${name}`, password = secret(`${username}-password.txt`);
    const hash = await hashPassword(password);
    const changed = await db.query('UPDATE public.users SET password_hash=$1 WHERE username=$2 AND password_hash IS NULL RETURNING user_id', [hash, username]);
    if (changed.rowCount !== 1 || !await verifyPassword(password, hash)) throw new Error('Test account provisioning failed.');
  }
  console.info('Isolated test credentials and Argon2id accounts provisioned; no passwords/hashes printed.');
} catch (error) {
  console.error(JSON.stringify({ provisioning: 'FAIL', code: error.code || 'TEST_SETUP_FAILED' }));
  process.exitCode = 1;
} finally { await db.end(); }
