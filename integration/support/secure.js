import http from 'node:http';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { readSecureConfig } from '../../src/config/secure.js';
import { createSessionRedis } from '../../src/db/redis.js';
import { createAuth } from '../../src/auth/index.js';
import { createApp } from '../../src/app.js';
import { checkSecureAccess } from '../../src/db/secure-access.js';
import { digest } from '../../src/auth/sessions.js';

export const testSecret = name => readFileSync(new URL(`../../infra/phase3/local/${name}`, import.meta.url), 'utf8');
export const origin = 'http://127.0.0.1:5173';
export async function startSecureServer(t, authOverrides = {}) {
  const env = parseEnv(readFileSync(new URL('../../infra/phase3/local/backend.env', import.meta.url), 'utf8'));
  const config = readSecureConfig(env);
  if (config.database.port !== 5433 || config.database.host !== '127.0.0.1'
    || config.database.database !== 'smart_warehouse_phase3_test'
    || config.redis.host !== '127.0.0.1' || config.redis.port !== 6379
    || config.redis.username !== 'warehouse_session') throw new Error('Integration tests require the isolated test services.');
  const admin = new pg.Pool({ ...config.writer, user: 'postgres', password: testSecret('postgres-admin-password.txt') });
  const db = new pg.Pool(config.database), writer = new pg.Pool(config.writer);
  const redis = createSessionRedis(config.redis, {error(){}});
  let server;
  t.after(async () => {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (redis.isOpen) redis.destroy();
    await Promise.all([db.end(),writer.end(),admin.end()]);
  });
  const safe = (await admin.query("SELECT current_database()='smart_warehouse_phase3_test' AND current_setting('phase3.environment',true)='isolated-test-v1' AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='smart_warehouse') AS safe")).rows[0].safe;
  if (!safe) throw new Error('Refusing unsafe test cluster.');
  let deadline;
  try {
    await Promise.race([redis.connect(), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('Test Redis connection timed out.')), 6000);
    })]);
  } finally { clearTimeout(deadline); }
  await checkSecureAccess(db, writer);
  // Each fixture owns these synthetic login counters. Repeated test runs must
  // not consume the prior run's 15-minute IP/account budget. Never FLUSHDB or
  // delete sessions; the actual rate policy is still exercised within each test.
  const ip = digest('127.0.0.1');
  const rateKeys = [`ssw:p3:rate:login:ip:${ip}`];
  for (const username of ['p3_admin','p3_keeper','p3_staff','p3_viewer','p3_inactive','p3_nohash']) {
    const account = digest(username);
    rateKeys.push(`ssw:p3:rate:login:pair:${account}:${ip}`, `ssw:p3:rate:login:user:${account}`);
  }
  await redis.sendCommand(['DEL', ...rateKeys]);
  const auth = createAuth({ db: writer, redis, schema: config.schema, config: { ...config.auth, ...authOverrides } });
  server = http.createServer(createApp({ db, writerDb: writer, auth, schema: config.schema, logger: {error(){}} }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function request(path, { method='GET', body, cookie, csrf, requestOrigin=origin, headers={} }={}) {
    const result = await fetch(base+path,{ method, headers: { Origin:requestOrigin,
      ...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),
      ...(body===undefined?{}:{'Content-Type':'application/json'}),...headers },
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000) });
    return { status:result.status, body:result.status===204?null:await result.json(), headers:result.headers };
  }
  async function login(username='p3_admin', password=testSecret(`${username}-password.txt`)) {
    const result=await request('/auth/login',{method:'POST',body:{username,password}});
    if(result.status!==200) throw new Error(`Test login failed: ${username} HTTP${result.status}`);
    const cookie=result.headers.get('set-cookie').split(';')[0];
    const csrf=(await request('/auth/csrf',{cookie})).body.data.csrf_token;
    return {cookie,csrf,user:result.body.data};
  }
  return {db,writer,admin,redis,auth,base,request,login,config};
}
