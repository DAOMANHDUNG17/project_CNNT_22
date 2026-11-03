import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve from this file so running from another directory still uses the project .env.
const envPath = process.env.APP_ENV_FILE || fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

export function readConfig(env = process.env) {
  const required = (name) => {
    if (typeof env[name] !== 'string' || !env[name].trim()) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return env[name];
  };
  const integer = (name, fallback, max = 2147483647) => {
    const raw = env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1 || Number(raw) > max) {
      throw new Error(`Invalid positive integer environment variable: ${name}`);
    }
    return Number(raw);
  };
  const user = required('PGUSER');
  if (user.toLowerCase() === 'postgres') {
    throw new Error('Use a dedicated application role instead of postgres (PGUSER).');
  }
  const schema = env.PGSCHEMA ?? 'public';
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema)) {
    throw new Error('PGSCHEMA must be a simple PostgreSQL identifier (1-63 ASCII characters).');
  }
  const queryTimeout = integer('PGQUERY_TIMEOUT_MS', 5000);
  const host = env.HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('HOST must be a localhost loopback address.');
  }
  return {
    host,
    port: integer('PORT', 3000, 65535),
    schema,
    database: {
      host: required('PGHOST'),
      port: integer('PGPORT', 5432, 65535),
      database: required('PGDATABASE'),
      user,
      password: required('PGPASSWORD'),
      max: integer('PGPOOL_MAX', 5, 100),
      connectionTimeoutMillis: integer('PGCONNECT_TIMEOUT_MS', 5000),
      idleTimeoutMillis: 30000,
      statement_timeout: queryTimeout,
      query_timeout: queryTimeout + 1000,
      application_name: 'smart_warehouse_backend',
      // Additional guard for this read-only phase; database grants are the authority.
      options: '-c default_transaction_read_only=on',
    },
  };
}
