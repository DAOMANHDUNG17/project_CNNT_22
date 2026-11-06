import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCloudCatalog, cloudFunctions, checkCloudAccess } from '../src/db/cloud-access.js';
import { assertCloudColumns } from '../src/db/cloud-column-policy.js';
import { assertCloudReleaseReady } from '../src/cloud/release-gate.js';

function catalog() {
  return {
    roles: ['warehouse_readonly','warehouse_backend','warehouse_stock_executor','warehouse_admin_executor','warehouse_auth_executor'].map((rolname,i) => ({
      rolname, rolcanlogin: i<2, rolinherit:false, rolsuper:false, rolcreatedb:false, rolcreaterole:false, rolreplication:false, rolbypassrls:false,
    })),
    memberships: [{ role:'warehouse_auth_executor', member:'postgres', grantor:'supabase_admin', admin_option:true, inherit_option:false, set_option:false }],
    functions: Object.entries(cloudFunctions).map(([signature, owner]) => ({ signature, owner, prosecdef:true, allowed:true, unsafe_execute:false, proconfig:['search_path=pg_catalog, public, pg_temp'] })),
    checks: Object.fromEntries(['ownership','api_exposure','password_access','reader_isolation','sequence_access','public_grants','unexpected_definer'].map(k => [k,false])),
  };
}
test('Cloud policy allows only documented provider ADMIN-only inbound membership', () => {
  assert.doesNotThrow(() => assertCloudCatalog(catalog()));
  for (const mutation of [c=>c.roles[2].rolcanlogin=true,c=>c.roles[0].rolsuper=true,c=>c.roles[1].rolinherit=true,
    c=>c.roles.pop(),c=>c.memberships[0].set_option=true,c=>c.memberships[0].inherit_option=true,
    c=>c.memberships[0].grantor='postgres',c=>c.memberships[0].member='warehouse_backend',
    c=>c.functions[0].owner='postgres',c=>c.functions[0].prosecdef=false,c=>c.functions[0].unsafe_execute=true,
    c=>c.functions[0].proconfig=['search_path=public'],c=>c.functions.pop(),c=>c.functions[1]=c.functions[0]]) {
    const c=catalog(); mutation(c); assert.throws(()=>assertCloudCatalog(c),{code:'CLOUD_ACCESS_DENIED'});
  }
  for (const key of Object.keys(catalog().checks)) { const c=catalog(); c.checks[key]=true; assert.throws(()=>assertCloudCatalog(c)); }
});
test('column policy rejects direct inventory updates, hash reads, API grants and executor escalation', () => {
  const row = { role:'warehouse_backend',table:'inventory',column:'quantity_base',select:false,insert:false,update:false,references:false,delete:false,dangerous:false,grantable:false };
  assert.doesNotThrow(()=>assertCloudColumns([row]));
  for (const field of ['select','insert','update','references','delete','dangerous','grantable']) assert.throws(()=>assertCloudColumns([{...row,[field]:true}]));
  assert.throws(()=>assertCloudColumns([{...row,table:'users',column:'password_hash',select:true}]));
  assert.throws(()=>assertCloudColumns([{...row,role:'service_role',select:true}]));
  assert.throws(()=>assertCloudColumns([{...row,role:'warehouse_admin_executor',update:true}]));
  assert.doesNotThrow(()=>assertCloudColumns([{...row,role:'warehouse_stock_executor',select:true,update:true}]));
  assert.throws(()=>assertCloudColumns([{...row,role:'warehouse_stock_executor',select:true,update:true,grantable:true}]));
});
test('runtime preflight refuses wrong database, SQL identity and unencrypted connections', async () => {
  const identity={role:'warehouse_readonly',session_user:'warehouse_readonly',database:'postgres',read_only:'on',tls:true};
  for (const patch of [{database:'smart_warehouse'},{role:'postgres'},{session_user:'postgres'},{read_only:'off'},{tls:false}]) {
    const db={query:async()=>({rows:[{...identity,...patch}]})};
    await assert.rejects(checkCloudAccess(db,db),{code:'CLOUD_ACCESS_DENIED'});
  }
});
test('unresolved architecture cannot be activated using environment flags', () => {
  assert.throws(()=>assertCloudReleaseReady(),{code:'CLOUD_RELEASE_BLOCKED'});
});
