import { readFileSync } from 'node:fs';

const invalid = name => new Error(`Invalid or missing Cloud configuration: ${name}.`);
const required = (env, name) => {
  const value = env[name];
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\r\n\0]/u.test(value)) throw invalid(name);
  return value;
};
function integer(env, name, fallback, max) {
  const value = env[name] ?? String(fallback);
  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw invalid(name);
  return Number(value);
}
function file(env, name, read, maximum) {
  let value;
  try { value = read(required(env, name), 'utf8'); } catch { throw invalid(name); }
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > maximum || value.includes('\0')) throw invalid(name);
  return value;
}
function secret(env, name, read) {
  const value = env[`${name}_FILE`] ? file(env, `${name}_FILE`, read, 4096) : required(env, name);
  if (/[\r\n\0\uFEFF]/u.test(value)) throw invalid(name);
  return value;
}

function databaseTarget(env) {
  if (env.APP_PROFILE !== 'supabase-cloud') throw invalid('APP_PROFILE');
  const projectRef = required(env, 'SUPABASE_PROJECT_REF');
  if (!/^[a-z]{20}$/u.test(projectRef) || required(env, 'SUPABASE_EXPECTED_PROJECT_REF') !== projectRef) throw invalid('SUPABASE_EXPECTED_PROJECT_REF');
  const url = `https://${projectRef}.supabase.co`;
  if (required(env, 'SUPABASE_URL') !== url) throw invalid('SUPABASE_URL');
  if (required(env, 'PGDATABASE') !== 'postgres' || (env.PGSCHEMA ?? 'public') !== 'public') throw invalid('PGDATABASE/PGSCHEMA');
  const mode = required(env, 'SUPABASE_DB_MODE');
  const host = required(env, 'PGHOST');
  if (!['direct', 'session'].includes(mode) || (mode === 'direct' ? host !== `db.${projectRef}.supabase.co`
    : !/^[a-z0-9-]+\.pooler\.supabase\.com$/u.test(host))) throw invalid('SUPABASE_DB_MODE/PGHOST');
  const port = integer(env, 'PGPORT', 5432, 65535);
  if (port !== 5432) throw invalid('PGPORT (only direct/session 5432)');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || (env.PGSSLMODE && env.PGSSLMODE !== 'verify-full')) throw invalid('TLS verification');
  return { projectRef, url, mode, host, port };
}
function certificate(env, readFile) {
  const ca = file(env, 'PGSSLROOTCERT', readFile, 65536);
  if (!ca.trim().startsWith('-----BEGIN CERTIFICATE-----') || !ca.trim().endsWith('-----END CERTIFICATE-----')
      || ca.includes('PRIVATE KEY')) throw invalid('PGSSLROOTCERT');
  return ca;
}

// Pure configuration: no pg client, Auth request, dotenv fallback or side effect.
export function readCloudConfig(env, { readFile = readFileSync } = {}) {
  const { projectRef, url, mode, host, port } = databaseTarget(env);
  if (env.CLOUD_DIAGNOSTIC_ONLY === '1') throw invalid('diagnostic config cannot start the application');
  if (required(env, 'PGUSER') !== 'warehouse_readonly' || required(env, 'WRITE_PGUSER') !== 'warehouse_backend') throw invalid('PGUSER/WRITE_PGUSER');
  const httpHost = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(httpHost)) throw invalid('HOST');
  const allowedOrigins = required(env, 'ALLOWED_ORIGINS').split(',');
  for (const origin of allowedOrigins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw invalid('ALLOWED_ORIGINS'); }
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (parsed.origin !== origin || parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)
      || (parsed.protocol !== 'https:' && (env.NODE_ENV === 'production' || !local))) throw invalid('ALLOWED_ORIGINS');
  }
  const verification = required(env, 'SUPABASE_JWT_VERIFICATION');
  const algorithm = required(env, 'SUPABASE_JWT_ALGORITHM');
  if (!(verification === 'jwks' && ['ES256', 'RS256'].includes(algorithm))
    && !(verification === 'auth-server' && algorithm === 'HS256')) throw invalid('SUPABASE_JWT_VERIFICATION/SUPABASE_JWT_ALGORITHM');
  const publishableKey = required(env, 'SUPABASE_PUBLISHABLE_KEY');
  if (!/^sb_publishable_[A-Za-z0-9_-]{16,}$/u.test(publishableKey)) throw invalid('SUPABASE_PUBLISHABLE_KEY (publishable key required)');
  const ca = certificate(env, readFile);
  const max = integer(env, 'PGPOOL_MAX', 3, 5);
  const statementTimeout = integer(env, 'PGQUERY_TIMEOUT_MS', 5000, 30000);
  const database = { host, port, database: 'postgres', max,
    connectionTimeoutMillis: integer(env, 'PGCONNECT_TIMEOUT_MS', 5000, 30000),
    idleTimeoutMillis: 30000, statement_timeout: statementTimeout, query_timeout: statementTimeout + 1000,
    ssl: { ca, rejectUnauthorized: true, servername: host },
  };
  const pool = (role, name) => ({ ...database, user: mode === 'session' ? `${role}.${projectRef}` : role,
    password: secret(env, name, readFile), options: `-c default_transaction_read_only=${role === 'warehouse_readonly' ? 'on' : 'off'}`,
    application_name: `smart_warehouse_cloud_${role === 'warehouse_readonly' ? 'reader' : 'writer'}` });
  const rateKey = secret(env, 'CLOUD_RATE_HMAC_KEY', readFile);
  if (Buffer.byteLength(rateKey) < 32) throw invalid('CLOUD_RATE_HMAC_KEY (at least 32 bytes)');
  return { profile: 'supabase-cloud', projectRef, schema: 'public', host: httpHost,
    port: integer(env, 'PORT', 3000, 65535), allowedOrigins,
    database: pool('warehouse_readonly', 'PGPASSWORD'), writer: pool('warehouse_backend', 'WRITE_PGPASSWORD'),
    auth: { url, publishableKey, issuer: `${url}/auth/v1`, audience: 'authenticated', verification, algorithm,
      jwksUrl: `${url}/auth/v1/.well-known/jwks.json`, timeoutMs: 5000 }, rateKey,
    // This allowlist is the only Cloud information forwarded to Vite.
    frontend: { VITE_APP_PROFILE: 'supabase-cloud', VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: publishableKey },
  };
}

// A separate, explicitly diagnostic configuration. It cannot launch Express/Vite.
export function readCloudDiagnosticConfig(env, { readFile = readFileSync } = {}) {
  const { projectRef, mode, host, port } = databaseTarget(env);
  if (env.CLOUD_DIAGNOSTIC_ONLY !== '1' || required(env, 'PGUSER') !== 'postgres') throw invalid('CLOUD_DIAGNOSTIC_ONLY/PGUSER');
  const statementTimeout = integer(env, 'PGQUERY_TIMEOUT_MS', 5000, 10000);
  return { projectRef, expectedRole: 'postgres', database: {
    host, port, database: 'postgres', user: mode === 'session' ? `postgres.${projectRef}` : 'postgres',
    password: secret(env, 'PGPASSWORD', readFile),
    ssl: { ca: certificate(env, readFile), rejectUnauthorized: true, servername: host },
    connectionTimeoutMillis: integer(env, 'PGCONNECT_TIMEOUT_MS', 5000, 10000),
    statement_timeout: statementTimeout, query_timeout: statementTimeout + 1000,
    options: '-c default_transaction_read_only=on', application_name: 'smart_warehouse_catalog_diagnostic',
  } };
}
