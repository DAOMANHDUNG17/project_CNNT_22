import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertProviderBridge,providerBridgeBody,checkProviderBridge } from '../src/db/cloud-provider-bridge.js';
function bridge() { return {
  signature:'provider_session_window(uuid,uuid)',owner:'postgres',language:'sql',volatility:'s',definer:true,returns_set:true,
  argument_names:['p_subject','p_session','created_at','not_after'],result:'TABLE(created_at timestamp with time zone, not_after timestamp with time zone)',
  body:providerBridgeBody,settings:['search_path=""'],unsafe_acl:false,schema_unsafe:false,executor_allowed:true,executor_usage:true,
}; }
test('D8 accepts only exact read-only bridge, not a general postgres-owned definer', async () => {
  assert.doesNotThrow(()=>assertProviderBridge(bridge()));
  for(const patch of [{body:providerBridgeBody+' OR true'},{owner:'warehouse_auth_executor'},{settings:['search_path=public']},
    {unsafe_acl:true},{schema_unsafe:true},{executor_allowed:false},{executor_usage:false},{language:'plpgsql'},
    {volatility:'v'},{returns_set:false},{argument_names:['p_session','p_subject','created_at','not_after']},{result:'boolean'}]) {
    assert.throws(()=>assertProviderBridge({...bridge(),...patch}),{code:'CLOUD_BRIDGE_DENIED'});
  }
  await assert.rejects(checkProviderBridge({query:async()=>({rows:[bridge(),bridge()]})}),{code:'CLOUD_BRIDGE_DENIED'});
});
test('D8 SQL body matches the strict checker and exposes only session timestamps', () => {
  const sql=readFileSync(new URL('../scripts/supabase/55-provider-bridge.psql',import.meta.url),'utf8');
  const body=sql.split('$bridge$')[1].trim().replace(/\s+/gu,' ');
  assert.equal(body,providerBridgeBody);
  assert.doesNotMatch(body,/UPDATE|INSERT|DELETE|FOR UPDATE|password|token/iu);
  assert.match(sql,/GRANT EXECUTE[^;]+TO warehouse_auth_executor/u);
  const gate=readFileSync(new URL('../scripts/supabase/60-session-functions.psql',import.meta.url),'utf8');
  assert.ok(gate.includes('warehouse_private.provider_session_window(p_subject,p_session)'));
  assert.ok(!gate.includes('FROM auth.sessions'));
});
