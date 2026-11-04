import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig } from '../src/config/env.js';
import { readSecureConfig } from '../src/config/secure.js';

const valid = { PGHOST: '127.0.0.1', PGDATABASE: 'smart_warehouse', PGUSER: 'warehouse_readonly', PGPASSWORD: 'test-only' };

test('configuration uses a small pool, finite timeouts and read-only sessions', () => {
  const config = readConfig(valid);
  assert.equal(config.port, 3000);
  assert.equal(config.database.max, 5);
  assert.equal(config.database.connectionTimeoutMillis, 5000);
  assert.equal(config.database.statement_timeout, 5000);
  assert.equal(config.database.options, '-c default_transaction_read_only=on');
});

test('missing required configuration fails without exposing the password', () => {
  for (const name of Object.keys(valid)) {
    const env = { ...valid, [name]: '' };
    assert.throws(() => readConfig(env), new RegExp(name));
  }
});

test('application cannot use the postgres role', () => {
  assert.throws(() => readConfig({ ...valid, PGUSER: 'postgres' }), /dedicated application role/);
});

test('ports, pool size, timeouts and schema are validated', () => {
  for (const [name, value] of [
    ['PORT', '0'], ['PGPORT', '65536'], ['PGPORT', '5432oops'],
    ['PGPOOL_MAX', '101'], ['PGCONNECT_TIMEOUT_MS', '-1'],
    ['PGQUERY_TIMEOUT_MS', 'NaN'], ['PGSCHEMA', 'public; DROP TABLE products'],
  ]) {
    assert.throws(() => readConfig({ ...valid, [name]: value }), new RegExp(name));
  }
});

test('HTTP server accepts loopback hosts and rejects external bindings', () => {
  for (const HOST of ['127.0.0.1', '::1', 'localhost']) assert.equal(readConfig({ ...valid, HOST }).host, HOST);
  for (const HOST of ['0.0.0.0', '::', '192.168.1.2', 'example.com']) {
    assert.throws(() => readConfig({ ...valid, HOST }), /HOST/);
  }
});

const secure = { ...valid, WRITE_PGUSER: 'warehouse_backend', WRITE_PGPASSWORD: 'unit-only',
  REDIS_PASSWORD: 'unit-only', ALLOWED_ORIGINS: 'http://127.0.0.1:5173' };

test('secure config separates reader/writer credentials and enforces cookie/origin/schema policy', () => {
  const config = readSecureConfig(secure);
  assert.equal(config.writer.user, 'warehouse_backend');
  assert.equal(config.writer.options, '-c default_transaction_read_only=off');
  assert.equal(config.writer.host, config.database.host);
  assert.equal(config.writer.database, config.database.database);
  assert.equal(config.auth.secureCookies, false);
  const production = readSecureConfig({ ...secure, NODE_ENV: 'production', SESSION_SECURE: 'false', ALLOWED_ORIGINS: 'https://warehouse.example' });
  assert.equal(production.auth.secureCookies, true);
  for (const changes of [
    { WRITE_PGUSER: 'postgres' }, { PGUSER: 'other_reader' }, { PGSCHEMA: 'other_schema' },
    { ALLOWED_ORIGINS: '' }, { ALLOWED_ORIGINS: 'http://localhost:5173/' },
    { SESSION_SECURE: 'yes' }, { NODE_ENV: 'production' }, { REDIS_PORT: '65536' },
    { WRITE_PGPASSWORD: '' }, { REDIS_PASSWORD: '' },
  ]) assert.throws(() => readSecureConfig({ ...secure, ...changes }));
});
