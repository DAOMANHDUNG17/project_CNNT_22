export const providerBridgeBody = 'SELECT s.created_at, s.not_after FROM auth.sessions AS s WHERE s.id = p_session AND s.user_id = p_subject';
const normalize = value => typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
export function assertProviderBridge(row) {
  if (!row || row.signature !== 'provider_session_window(uuid,uuid)' || row.owner !== 'postgres'
    || row.language !== 'sql' || row.volatility !== 's' || row.definer !== true || row.returns_set !== true
    || JSON.stringify(row.argument_names) !== JSON.stringify(['p_subject','p_session','created_at','not_after'])
    || row.result !== 'TABLE(created_at timestamp with time zone, not_after timestamp with time zone)'
    || normalize(row.body) !== providerBridgeBody || !Array.isArray(row.settings) || row.settings.length !== 1
    || !/^search_path=(?:"")?$/u.test(row.settings[0]) || row.unsafe_acl !== false || row.schema_unsafe !== false
    || row.executor_allowed !== true || row.executor_usage !== true) {
    throw Object.assign(new Error('Provider session bridge differs from the approved D8 policy.'), { code: 'CLOUD_BRIDGE_DENIED' });
  }
}
export async function checkProviderBridge(db) {
  const rows = (await db.query(`SELECT p.proname||'('||oidvectortypes(p.proargtypes)||')' AS signature,
    pg_get_userbyid(p.proowner) AS owner,l.lanname AS language,p.provolatile AS volatility,p.prosecdef AS definer,
    p.proretset AS returns_set,p.proargnames AS argument_names,pg_get_function_result(p.oid) AS result,
    p.prosrc AS body,p.proconfig AS settings,
    has_function_privilege('warehouse_auth_executor',p.oid,'EXECUTE') AS executor_allowed,
    has_schema_privilege('warehouse_auth_executor',n.oid,'USAGE') AS executor_usage,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.privilege_type='EXECUTE' AND (a.grantee NOT IN (p.proowner,'warehouse_auth_executor'::regrole) OR a.is_grantable)) AS unsafe_acl,
    (n.nspowner<>'postgres'::regrole OR EXISTS(SELECT 1 FROM aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
      WHERE a.grantee<>n.nspowner AND (a.grantee<>'warehouse_auth_executor'::regrole OR a.privilege_type<>'USAGE' OR a.is_grantable))
      OR EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('warehouse_readonly','warehouse_backend','warehouse_stock_executor','warehouse_admin_executor','anon','authenticated','service_role')
        AND (has_schema_privilege(r.oid,n.oid,'USAGE,CREATE') OR has_function_privilege(r.oid,p.oid,'EXECUTE')))) AS schema_unsafe
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='warehouse_private'`)).rows;
  if (rows.length !== 1) throw Object.assign(new Error('Unexpected provider bridge inventory.'), { code: 'CLOUD_BRIDGE_DENIED' });
  assertProviderBridge({ ...rows[0], signature: rows[0].signature.replace(/, /gu, ',') });
}
