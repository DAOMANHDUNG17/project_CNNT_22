import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { startSecureServer } from './support/secure.js';
import { hashPassword } from '../src/auth/passwords.js';

test('isolated PostgreSQL admin ACL, last-admin guard and independent connection serialization', async t => {
  const ctx = await startSecureServer(t);
  const actor = (await ctx.admin.query("SELECT user_id::text AS id FROM public.users WHERE username='p3_admin' AND role='ADMIN' AND is_active")).rows[0]?.id;
  assert.ok(actor, 'The isolated test fixture requires an active p3_admin.');
  const call = (client, action, payload) => client.query(
    'SELECT public.admin_dashboard_write($1::bigint,$2::text,$3::jsonb) AS data', [actor, action, JSON.stringify(payload)]);

  await t.test('runtime roles cannot bypass functions or read credentials with reader', async () => {
    await assert.rejects(ctx.db.query('SELECT password_hash FROM public.users LIMIT 0'), e => e.code === '42501');
    await assert.rejects(ctx.db.query('UPDATE public.inventory SET quantity_base=quantity_base WHERE false'), e => e.code === '42501');
    await assert.rejects(ctx.writer.query('UPDATE public.inventory SET quantity_base=quantity_base WHERE false'), e => e.code === '42501');
    await assert.rejects(ctx.writer.query('INSERT INTO public.products(product_id,product_name,base_unit) SELECT $1,$2,$3 WHERE false',
      ['NO_INSERT', 'No insertion', 'item']), e => e.code === '42501');
    await assert.rejects(ctx.db.query('SELECT public.admin_dashboard_write($1,$2,$3)', [actor, 'product.create', '{}']), e => e.code === '42501');
    const metadata = (await ctx.admin.query(`SELECT
      has_column_privilege('warehouse_admin_executor','public.users','password_hash','SELECT') AS admin_reads_hash,
      has_any_column_privilege('warehouse_admin_executor','public.inventory','UPDATE') AS admin_updates_stock,
      has_any_column_privilege('warehouse_backend','public.users','INSERT,UPDATE,REFERENCES') AS backend_writes_users,
      has_function_privilege('warehouse_readonly','public.record_stock_movement(uuid,bigint,character varying,character varying,character varying,integer)','EXECUTE') AS reader_can_move_stock`)).rows[0];
    assert.deepEqual(metadata, { admin_reads_hash: false, admin_updates_stock: false, backend_writes_users: false, reader_can_move_stock: false });
  });

  await t.test('last active admin cannot be demoted, including own account, with all fixture changes rolled back', async () => {
    const before = (await ctx.admin.query("SELECT user_id::text AS id,is_active FROM public.users WHERE role='ADMIN' ORDER BY user_id")).rows;
    const client = await ctx.admin.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='5s'");
      // This uncommitted test view cannot change the state seen by another connection.
      await client.query("UPDATE public.users SET is_active=false WHERE role='ADMIN' AND user_id<>$1", [actor]);
      await client.query('SET LOCAL ROLE warehouse_backend');
      await assert.rejects(call(client, 'user.update', { user_id: actor, role: 'VIEWER' }), e => e.code === 'PZA05');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    const after = (await ctx.admin.query("SELECT user_id::text AS id,is_active FROM public.users WHERE role='ADMIN' ORDER BY user_id")).rows;
    assert.deepEqual(after, before, 'The last-admin test must preserve the fixture administrators.');
  });

  await t.test('user writes on two independent backend connections serialize on the shared account lock', async () => {
    const ids = [];
    let a, b;
    try {
      const encoded = await hashPassword(randomBytes(24).toString('base64url'));
      for (let i = 0; i < 2; i++) {
        const result = await call(ctx.writer, 'user.create', { username: `sql_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
          display_name: 'Synthetic SQL security user', role: 'STAFF', password_hash: encoded });
        ids.push(result.rows[0].data.user_id);
      }
      a = await ctx.writer.connect(); b = await ctx.writer.connect();
      const pidA = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pidB = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      assert.notEqual(pidA, pidB, 'Concurrency must use separate PostgreSQL connections.');
      await a.query('BEGIN'); await b.query('BEGIN');
      await a.query("SET LOCAL statement_timeout='5s'"); await b.query("SET LOCAL statement_timeout='5s'");
      await call(a, 'user.status', { user_id: ids[0], is_active: false });
      const waiting = call(b, 'user.status', { user_id: ids[1], is_active: false });
      waiting.catch(() => {}); // Preserve the rejection for the await below without an unhandled event.
      let observed = false;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const state = (await ctx.admin.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [pidB])).rows[0];
        if (state?.wait_event_type === 'Lock' && state.wait_event === 'advisory') { observed = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(observed, true, 'The second account mutation must wait for the first transaction.');
      await a.query('COMMIT');
      assert.equal((await waiting).rows[0].data.is_active, false);
      await b.query('COMMIT');
    } finally {
      for (const client of [a, b]) if (client) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
      for (const user_id of ids) await call(ctx.writer, 'user.status', { user_id, is_active: false });
    }
  });
});
