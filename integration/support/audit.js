import { createHash } from 'node:crypto';
import pg from 'pg';

export async function snapshotDatabase(db) {
  const tables = ['products', 'product_units', 'inventory', 'stock_transactions', 'scan_points'];
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const data = {};
  for (const name of tables) {
    // Text preserves bigint precision and never reads users. Store hashes/counts only.
    const result = await db.query(`SELECT row_to_json(t)::text AS row FROM public.${pg.escapeIdentifier(name)} t`);
    data[name] = { count: result.rows.length, sha256: hash(result.rows.map((row) => row.row).sort()) };
  }
  const names = [...tables, 'users']; // Metadata only, never users rows.
  const columns = (await db.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
    a.attnum, a.attname, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull, a.attidentity,
    a.attgenerated, pg_get_expr(d.adbin,d.adrelid) AS expression FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,a.attnum`, [names])).rows;
  const constraints = (await db.query(`SELECT c.relname, con.conname, con.convalidated, pg_get_constraintdef(con.oid) AS definition
    FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname,con.conname`, [names])).rows;
  const indexes = (await db.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename,indexname`, [names])).rows;
  const triggers = (await db.query(`SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=ANY($1::text[]) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`, [names])).rows;
  const functions = (await db.query(`SELECT pg_get_function_identity_arguments(p.oid) AS arguments,
    md5(pg_get_functiondef(p.oid)) AS definition_md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='record_stock_movement' AND p.prokind='f' ORDER BY p.oid`)).rows;
  return { data, schemaSha256: hash({ columns, constraints, indexes, triggers }), protectedFunctions: functions };
}
