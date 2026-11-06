import { readFileSync } from 'node:fs';
import { readConfig } from './env.js';
import { readRuntimeProfile } from './runtime-profile.js';

export function secret(env, name) {
  if (env[`${name}_FILE`]) {
    const value = readFileSync(env[`${name}_FILE`], 'utf8');
    if (!value || /[\r\n\0\uFEFF]/u.test(value)) throw new Error(`Invalid secret file for ${name}.`);
    return value;
  }
  if (!env[name]) throw new Error(`Missing required environment variable: ${name}`);
  return env[name];
}

export function readSecureConfig(env = process.env) {
  if (readRuntimeProfile(env) !== 'local-test') throw new Error('Use the dedicated Cloud entry point; the Redis runtime cannot serve supabase-cloud.');
  const base = readConfig({ ...env, PGPASSWORD: secret(env, 'PGPASSWORD') });
  if (base.schema !== 'public') throw new Error('Secure runtime requires PGSCHEMA=public.');
  if (base.database.user !== 'warehouse_readonly' || env.WRITE_PGUSER !== 'warehouse_backend') {
    throw new Error('Secure runtime requires warehouse_readonly and warehouse_backend roles.');
  }
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean).map(value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) {
      throw new Error('ALLOWED_ORIGINS must contain exact HTTP(S) origins.');
    }
    return url.origin;
  });
  if (!allowedOrigins.length) throw new Error('ALLOWED_ORIGINS is required.');
  if (env.SESSION_SECURE && !['true', 'false'].includes(env.SESSION_SECURE)) throw new Error('Invalid SESSION_SECURE.');
  const secureCookies = env.SESSION_SECURE === 'true' || env.NODE_ENV === 'production';
  if (env.NODE_ENV === 'production' && allowedOrigins.some(origin => !origin.startsWith('https://'))) {
    throw new Error('Production requires HTTPS origins.');
  }
  const redisPort = Number(env.REDIS_PORT || 6379);
  if (!Number.isInteger(redisPort) || redisPort < 1 || redisPort > 65535) throw new Error('Invalid REDIS_PORT.');
  return {
    ...base,
    writer: { ...base.database, user: env.WRITE_PGUSER, password: secret(env, 'WRITE_PGPASSWORD'),
      options: '-c default_transaction_read_only=off', application_name: 'smart_warehouse_writer' },
    redis: { host: env.REDIS_HOST || '127.0.0.1', port: redisPort,
      username: env.REDIS_USERNAME || 'warehouse_session', password: secret(env, 'REDIS_PASSWORD') },
    auth: { allowedOrigins, secureCookies, idleMs: 30 * 60_000, absoluteMs: 8 * 60 * 60_000 },
  };
}
