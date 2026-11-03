// Creates isolated test credentials once. Never prints or overwrites credentials.
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const directory = resolve('infra/phase3/local');
mkdirSync(directory, { recursive: true });
if (existsSync(join(directory, 'compose.env'))) throw new Error('Test configuration already exists; inspect it instead of resetting credentials.');
const createSecret = (name) => {
  if (existsSync(join(directory, name))) throw new Error('Existing test secret must not be overwritten.');
  const value = randomBytes(32).toString('base64url');
  writeFileSync(join(directory, name), value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return value;
};
const health = createSecret('redis-health-password.txt');
const session = createSecret('redis-session-password.txt');
createSecret('postgres-admin-password.txt');
createSecret('backend-password.txt');
createSecret('reader-password.txt');
for (const name of ['admin', 'keeper', 'staff', 'viewer', 'inactive']) createSecret(`p3_${name}-password.txt`);
const digest = value => createHash('sha256').update(value).digest('hex');
writeFileSync(join(directory, 'redis-users.acl'), [
  'user default reset off',
  `user warehouse_health reset on #${digest(health)} +ping`,
  `user warehouse_session reset on #${digest(session)} ~ssw:p3:session:* ~ssw:p3:rate:* +ping +hello +get +set +del +pexpire +pttl +incr +eval +evalsha +script|load +client|setname +client|setinfo`,
].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
writeFileSync(join(directory, 'compose.env'), [
  'REDIS_IMAGE=redis@sha256:21090af93f8324db2f0f0f4f38a7c60369d47d917e000c3423d89d2ae2883537',
  'POSTGRES_IMAGE=postgres@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5',
  'REDIS_ACL_FILE=./local/redis-users.acl', 'REDIS_HEALTH_PASSWORD_FILE=./local/redis-health-password.txt',
  'POSTGRES_ADMIN_PASSWORD_FILE=./local/postgres-admin-password.txt',
].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
writeFileSync(join(directory, 'backend.env'), [
  'NODE_ENV=development', 'HOST=127.0.0.1', 'PORT=3000',
  'PGHOST=127.0.0.1', 'PGPORT=5433', 'PGDATABASE=smart_warehouse_phase3_test', 'PGUSER=warehouse_readonly',
  'PGPASSWORD_FILE=infra/phase3/local/reader-password.txt',
  'WRITE_PGUSER=warehouse_backend', 'WRITE_PGPASSWORD_FILE=infra/phase3/local/backend-password.txt',
  'REDIS_HOST=127.0.0.1', 'REDIS_PORT=6379', 'REDIS_USERNAME=warehouse_session',
  'REDIS_PASSWORD_FILE=infra/phase3/local/redis-session-password.txt',
  'ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:5173,http://localhost:5173',
  'SESSION_SECURE=false',
].join('\n') + '\n', { flag: 'wx', mode: 0o600 });
console.info('Created isolated test configuration and protected secret files; no values printed. Main .env unchanged.');
