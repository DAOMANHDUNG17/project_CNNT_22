// OFFLINE source preparation only. No driver, shell, connection or SQL execution.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/gu, '\n');
const hash = source => createHash('sha256').update(source).digest('hex');
const prefix = '\\set ON_ERROR_STOP on\n\\ir review-gate.psql\n-- Include in ONE reviewed migration transaction; never run standalone.\n';
function emit(name, source) {
  const target = new URL(name, import.meta.url);
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== source) throw new Error(`Review artifact stale: ${name}`);
  } else writeFileSync(target, source);
}
const schemaSource = read('scripts/phase3/20-create-test-schema.psql');
let schema = schemaSource.slice(schemaSource.indexOf('CREATE TABLE public.users'), schemaSource.lastIndexOf('COMMIT;'));
schema = schema.replace('  password_hash text,', '  password_hash text,\n  auth_version bigint NOT NULL DEFAULT 0,');
schema = schema.replace('  CONSTRAINT fk_tx_unit_belongs_to_product', '  request_scan_code varchar(80),\n  CONSTRAINT fk_tx_unit_belongs_to_product');
emit('20-schema.psql', prefix + '-- Final six-table baseline, no fixtures or test bootstrap.\n' + schema);
for (const [sourcePath, name, signature, owner] of [
  ['scripts/phase3/40-hardening-test.psql', '40-stock-function.psql', 'record_stock_movement(uuid,bigint,varchar,varchar,varchar,integer)', 'warehouse_stock_executor'],
  ['scripts/admin-dashboard/10-admin-test.psql', '50-admin-function.psql', 'admin_dashboard_write(bigint,text,jsonb)', 'warehouse_admin_executor'],
]) {
  const source = read(sourcePath);
  const match = source.match(/CREATE OR REPLACE FUNCTION public\.[\s\S]*?\$function\$;/u);
  if (!match) throw new Error('Source function not found.');
  let body = match[0];
  if (owner === 'warehouse_admin_executor') body = body.replace('BEGIN\n', "BEGIN\n  -- Cloud must never treat a legacy password hash change as a provider operation.\n  IF p_action IN ('user.create','user.reset-password') THEN\n    RAISE EXCEPTION USING ERRCODE='PZA07',MESSAGE='Cloud account lifecycle is blocked';\n  END IF;\n");
  emit(name, prefix + `-- Extracted function definition only from ${sourcePath}\n-- Source definition SHA256: ${hash(match[0])}\n`
    + body + `\nREVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated,service_role;\n`
    + `-- Temporary ownership capability, removed in 70-grants.psql before COMMIT.\n`
    + `GRANT ${owner} TO postgres WITH INHERIT FALSE, SET TRUE;\nGRANT CREATE ON SCHEMA public TO ${owner};\n`
    + `ALTER FUNCTION public.${signature} OWNER TO ${owner};\nSET LOCAL ROLE ${owner};\nALTER FUNCTION public.${signature} SECURITY DEFINER;\n`
    + `GRANT EXECUTE ON FUNCTION public.${signature} TO warehouse_backend;\nRESET ROLE;\n`);
}
