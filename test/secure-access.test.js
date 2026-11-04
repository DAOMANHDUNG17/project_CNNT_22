import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSecureAccess } from '../src/db/secure-access.js';

const functions = () => [
  { proname: 'record_stock_movement', owner: 'warehouse_stock_executor' },
  { proname: 'admin_dashboard_write', owner: 'warehouse_admin_executor' },
].map(row => ({ ...row, prosecdef: true, allowed: true, expected_signature: true,
  unsafe_execute: false, proconfig: ['search_path=pg_catalog, public, pg_temp'] }));
function fixture({ mutate = () => {}, unsafeReader = false, loginExecutor = false } = {}) {
  return ['warehouse_readonly','warehouse_backend'].map(role => ({
    async query(sql) {
      if (sql.includes('current_user AS role')) return { rows: [{ role, session_user: role,
        read_only: role === 'warehouse_readonly' ? 'on' : 'off' }] };
      if (sql.includes('FROM pg_roles r WHERE')) return { rows: [
        { rolname: 'warehouse_stock_executor', rolcanlogin: loginExecutor }, { rolname: 'warehouse_admin_executor' },
      ] };
      if (sql.includes('SELECT p.proname')) {
        const rows = functions(); mutate(rows); return { rows };
      }
      if (sql.includes("SELECT has_any_column_privilege('public.users'")) return { rows: [{ unsafe: unsafeReader }] };
      if (sql.includes('AS unsafe')) return { rows: [{ unsafe: false }] };
      if (sql.includes('LIMIT 0')) return { rows: [] };
      throw new Error('Unexpected preflight query.');
    },
  }));
}

test('startup accepts the supported roles and exact hardened functions', async () => {
  await checkSecureAccess(...fixture());
});

test('startup rejects swapped owners, changed signatures, extra settings and unsafe EXECUTE grants', async () => {
  for (const mutate of [
    rows => { [rows[0].owner,rows[1].owner] = [rows[1].owner,rows[0].owner]; },
    rows => { rows[0].expected_signature = false; },
    rows => { rows[1].proconfig.push('row_security=off'); },
    rows => { rows[0].unsafe_execute = true; },
    rows => { rows.pop(); },
  ]) await assert.rejects(checkSecureAccess(...fixture({ mutate })), { code: 'RUNTIME_ACCESS_DENIED' });
});

test('startup rejects a reader with auth/function access and a login-capable executor', async () => {
  for (const options of [{ unsafeReader: true }, { loginExecutor: true }]) {
    await assert.rejects(checkSecureAccess(...fixture(options)), { code: 'RUNTIME_ACCESS_DENIED' });
  }
});
