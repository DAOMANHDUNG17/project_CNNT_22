import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { readCloudConfig } from '../src/config/cloud.js';
import { readRuntimeProfile } from '../src/config/runtime-profile.js';
import { loadCloudEnvironment } from '../scripts/lib/cloud-environment.js';

const ref = 'a'.repeat(20);
const env = () => ({ APP_PROFILE: 'supabase-cloud', SUPABASE_PROJECT_REF: ref, SUPABASE_EXPECTED_PROJECT_REF: ref,
  SUPABASE_URL: `https://${ref}.supabase.co`, PGHOST: `db.${ref}.supabase.co`, PGDATABASE: 'postgres',
  PGUSER: 'warehouse_readonly', WRITE_PGUSER: 'warehouse_backend', SUPABASE_DB_MODE: 'direct',
  SUPABASE_JWT_VERIFICATION: 'jwks', SUPABASE_JWT_ALGORITHM: 'ES256', PGSSLROOTCERT: 'synthetic-ca',
  SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'a'.repeat(24)}`, PGPASSWORD: 'synthetic-reader',
  WRITE_PGPASSWORD: 'synthetic-writer', CLOUD_RATE_HMAC_KEY: 'synthetic-key-'.repeat(4),
  ALLOWED_ORIGINS: 'http://127.0.0.1:5173' });
const readFile = () => '-----BEGIN CERTIFICATE-----\nSYNTHETIC-CONFIG-ONLY\n-----END CERTIFICATE-----';

test('Cloud configuration separates transport username, SQL identity, secrets and public Vite values', () => {
  const config = readCloudConfig(env(), { readFile });
  assert.equal(config.database.user, 'warehouse_readonly');
  assert.equal(config.writer.user, 'warehouse_backend');
  assert.equal(config.database.options, '-c default_transaction_read_only=on');
  assert.equal(config.writer.options, '-c default_transaction_read_only=off');
  assert.equal(config.database.ssl.rejectUnauthorized, true);
  assert.equal(config.database.ssl.servername, env().PGHOST);
  assert.equal(config.database.max, 3);
  assert.deepEqual(Object.keys(config.frontend).sort(), ['VITE_APP_PROFILE', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL']);
  assert.ok(!JSON.stringify(config.frontend).includes('synthetic-reader'));
  const session = readCloudConfig({ ...env(), SUPABASE_DB_MODE: 'session', PGHOST: 'aws-0-test.pooler.supabase.com' }, { readFile });
  assert.equal(session.writer.user, `warehouse_backend.${ref}`);
});

test('Cloud configuration fails closed on target, TLS, admin roles, algorithms and pooler drift', () => {
  for (const changes of [
    { APP_PROFILE: 'local-test' }, { SUPABASE_EXPECTED_PROJECT_REF: 'b'.repeat(20) }, { SUPABASE_URL: 'https://wrong.invalid' },
    { PGDATABASE: 'smart_warehouse' }, { PGSCHEMA: 'private' }, { PGUSER: 'postgres' }, { WRITE_PGUSER: 'postgres' },
    { PGHOST: '127.0.0.1' }, { PGPORT: '6543' }, { SUPABASE_DB_MODE: 'transaction' },
    { SUPABASE_DB_MODE: 'session', PGHOST: 'pooler.supabase.com.attacker.invalid' },
    { PGSSLMODE: 'no-verify' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { PGPOOL_MAX: '6' },
    { SUPABASE_JWT_ALGORITHM: 'none' }, { SUPABASE_JWT_ALGORITHM: 'HS256' },
    { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_must-not-be-a-browser-key' }, { CLOUD_RATE_HMAC_KEY: 'short' },
    { ALLOWED_ORIGINS: '*' }, { ALLOWED_ORIGINS: 'http://remote.invalid' }, { NODE_ENV: 'production' },
  ]) assert.throws(() => readCloudConfig({ ...env(), ...changes }, { readFile }));
  assert.throws(() => readCloudConfig(env(), { readFile() { throw new Error('secret-driver-diagnostic'); } }), error => !error.message.includes('diagnostic'));
  assert.equal(readCloudConfig({ ...env(), SUPABASE_JWT_VERIFICATION: 'auth-server', SUPABASE_JWT_ALGORITHM: 'HS256' }, { readFile }).auth.verification, 'auth-server');
});

test('Cloud env file is explicit and authoritative; relative secret paths never depend on cwd', () => {
  assert.throws(() => loadCloudEnvironment({}, () => { throw new Error('must not read'); }), /explicit APP_ENV_FILE/);
  assert.throws(() => loadCloudEnvironment({ APP_ENV_FILE: resolve('.env') }, () => { throw new Error('must not read main'); }), /local main/);
  const path = resolve('synthetic/config/cloud.env');
  const selected = loadCloudEnvironment({ APP_ENV_FILE: path, PGHOST: '127.0.0.1', WRITE_PGPASSWORD:'stale-other-project', SUPABASE_SECRET_KEY:'stale-secret', VITE_PRIVATE_KEY:'must-not-forward' }, () =>
    'APP_PROFILE=supabase-cloud\nPGHOST=chosen-host\nPGPASSWORD_FILE=reader.txt\nPGSSLROOTCERT=ca.pem');
  assert.equal(selected.PGHOST, 'chosen-host');
  assert.equal(selected.PGPASSWORD_FILE, resolve(dirname(path), 'reader.txt'));
  assert.equal(selected.PGSSLROOTCERT, resolve(dirname(path), 'ca.pem'));
  assert.equal(selected.WRITE_PGPASSWORD, undefined);
  assert.equal(selected.SUPABASE_SECRET_KEY, undefined);
  assert.equal(selected.VITE_PRIVATE_KEY, undefined);
  assert.throws(() => loadCloudEnvironment({ APP_ENV_FILE: path }, () => 'APP_PROFILE=local-test'), /must declare/);
  assert.equal(readRuntimeProfile({}), 'local-test');
  assert.throws(() => readRuntimeProfile({ APP_PROFILE: 'unknown' }));
});

export { env as cloudTestEnvironment, readFile as cloudTestReadFile };
