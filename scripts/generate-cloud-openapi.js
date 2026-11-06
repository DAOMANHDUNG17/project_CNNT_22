import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function cloudSpecification(source) {
  const spec = structuredClone(source);
  spec.info.title += ' — Supabase Cloud (review)';
  spec.info.version = '2.0.0-review';
  spec.info.description = 'Prepared Cloud contract, NOT evidence of deployment. Bearer Supabase JWT, live PostgreSQL RBAC/session gate. No Redis/cookie CSRF. User creation and password reset are blocked pending provider lifecycle verification. All Cloud runtime activation remains blocked; see SUPABASE_IMPLEMENTATION_STATUS.md.';
  spec.security = [{ bearerAuth: [] }];
  spec.components.securitySchemes = { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } };
  for (const [path, item] of Object.entries(spec.paths)) for (const [method, op] of Object.entries(item)) {
    if (!['get', 'post', 'patch'].includes(method)) continue;
    if (path !== '/api/health') op.security = [{ bearerAuth: [] }];
    op.parameters = (op.parameters ?? []).filter(p => p.name !== 'X-CSRF-Token');
    for (const [status, response] of Object.entries(op.responses)) {
      if (response.headers) delete response.headers['Set-Cookie'];
      if (status === '403') response.description = 'Business role or exact browser Origin rejected.';
      if (status === '503') response.description = 'Database/Auth provider unavailable, stock outcome unknown or Cloud account operation blocked.';
    }
  }
  const login = spec.paths['/api/auth/login'].post;
  login.operationId = 'confirmLogin';
  login.summary = 'Confirm business identity after provider email/password sign-in';
  login.description = 'Requires Bearer token and allowed Origin. Empty JSON object only; never send credentials to Express. No cookie is issued. Role comes from PostgreSQL, not JWT metadata.';
  login.requestBody = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, maxProperties: 0 } } } };
  const csrf = spec.paths['/api/auth/csrf'].get;
  csrf.operationId = 'authCapabilities';
  csrf.summary = 'Report Bearer authentication capability';
  csrf.description = 'Compatibility URL only; no CSRF token is issued in Cloud mode.';
  csrf.responses['200'] = { description: 'Bearer capability', content: { 'application/json': { schema: {
    type: 'object', required: ['data'], additionalProperties: false, properties: { data: {
      type: 'object', required: ['mode', 'csrf_required'], additionalProperties: false,
      properties: { mode: { const: 'bearer' }, csrf_required: { const: false } },
    } },
  } } } };
  spec.paths['/api/auth/me'].get.description = 'Verify JWT, provider session mapping, active state and current business role. No role is trusted from user metadata.';
  spec.paths['/api/auth/logout'].post.description = 'Revoke the verified application session, then the browser signs out of the provider with local scope. Does not claim all provider access tokens are invalidated. No retry on mutation failure; 503 requires explicit user retry.';
  for (const path of ['/api/users', '/api/users/{id}/reset-password']) {
    const op = spec.paths[path].post;
    op.description = 'BLOCKED: authorized, otherwise valid Cloud requests return 503 CLOUD_ACCOUNT_OPERATION_BLOCKED. Existing local payload retained for compatibility only; no provider account/password mutation is implemented.';
    for (const status of Object.keys(op.responses)) if (status.startsWith('2')) delete op.responses[status];
  }
  // Remove orphaned cookie/CSRF prose from reusable schemas while retaining local-only UserCreate compatibility.
  delete spec.components.schemas.CsrfResponse;
  delete spec.components.schemas.Csrf;
  delete spec.components.schemas.Login;
  return spec;
}
const source = JSON.parse(readFileSync(new URL('../docs/openapi.json', import.meta.url), 'utf8'));
const output = JSON.stringify(cloudSpecification(source), null, 2) + '\n';
const target = new URL('../docs/openapi-cloud.json', import.meta.url);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== output) throw new Error('Cloud OpenAPI is stale. Run npm run docs:cloud.');
  } else writeFileSync(target, output);
}
