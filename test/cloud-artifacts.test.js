import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { WarehouseApi } from '../docs/api-client.ts';
import { cloudSpecification } from '../scripts/generate-cloud-openapi.js';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r\n/gu,'\n');

test('Cloud contract preserves 29 operations with explicit auth changes and blocked account writes', () => {
  const local=JSON.parse(read('docs/openapi.json')), cloud=JSON.parse(read('docs/openapi-cloud.json'));
  assert.deepEqual(cloud,cloudSpecification(local));
  assert.equal(Object.keys(cloud.paths).length,24);
  const operations=Object.values(cloud.paths).flatMap(item=>Object.entries(item).filter(([m])=>['get','post','patch'].includes(m)).map(([,op])=>op));
  assert.equal(operations.length,29);
  for(const op of operations) assert.equal(typeof WarehouseApi.prototype[op.operationId],'function');
  assert.deepEqual(cloud.security,[{bearerAuth:[]}]);
  assert.equal(cloud.paths['/api/auth/login'].post.requestBody.content['application/json'].schema.maxProperties,0);
  for(const path of ['/api/users','/api/users/{id}/reset-password']) assert.ok(Object.keys(cloud.paths[path].post.responses).every(k=>!k.startsWith('2')));
  const refs=JSON.stringify(cloud).matchAll(/"\$ref":"#\/([^" ]+)"/gu);
  for(const [,ref] of refs) assert.ok(ref.split('/').reduce((node,k)=>node?.[k],cloud),`missing ${ref}`);
});
test('SQL candidates preserve hardened stock body and final schema without test bootstrap', () => {
  const source=read('scripts/phase3/40-hardening-test.psql').match(/CREATE OR REPLACE FUNCTION public\.[\s\S]*?\$function\$;/u)[0];
  assert.ok(read('scripts/supabase/40-stock-function.psql').includes(source));
  const schema=read('scripts/supabase/20-schema.psql');
  assert.equal((schema.match(/CREATE TABLE public\./gu)||[]).length,6);
  assert.ok(schema.includes('auth_version bigint NOT NULL DEFAULT 0'));
  assert.ok(schema.includes('request_scan_code varchar(80),'));
  assert.ok(schema.includes('quantity_packages::bigint * conversion_factor_snapshot::bigint'));
  const admin=read('scripts/supabase/50-admin-function.psql');
  assert.ok(admin.includes("IF p_action IN ('user.create','user.reset-password') THEN"));
  assert.ok(admin.includes("ERRCODE='PZA07'"));
  for(const name of readdirSync(new URL('../scripts/supabase/',import.meta.url)).filter(n=>n.endsWith('.psql')&&n!=='review-gate.psql')) {
    const sql=read('scripts/supabase/'+name);
    assert.ok(sql.startsWith('\\set ON_ERROR_STOP on\n\\ir review-gate.psql'),name);
    assert.doesNotMatch(sql,/guard-test|CREATE DATABASE|DROP DATABASE|TRUNCATE TABLE|GRANT ALL/iu);
  }
  assert.ok(read('scripts/supabase/review-gate.psql').includes('\\quit 3'));
});
test('Cloud launcher rejects missing configuration offline before starting children', () => {
  const env={...process.env}; delete env.APP_ENV_FILE;
  const result=spawnSync(process.execPath,['scripts/dev-cloud.js'],{env,encoding:'utf8',timeout:5000});
  assert.equal(result.status,1);
  assert.match(result.stderr,/explicit APP_ENV_FILE/u);
  assert.doesNotMatch(result.stdout,/listening|Docker|connected/u);
});
