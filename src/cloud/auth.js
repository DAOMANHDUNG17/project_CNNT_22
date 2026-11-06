import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { HttpError } from '../http/errors.js';

const roles = new Set(['ADMIN', 'KEEPER', 'STAFF', 'VIEWER']);
const unauthenticated = () => new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
const unavailable = () => new HttpError(503, 'AUTHORIZATION_UNAVAILABLE', 'Authorization is temporarily unavailable.');
const identity = row => ({ user_id: String(row.user_id), username: row.username, display_name: row.display_name, role: row.role });
const noQuery = req => { if (Object.keys(req.query).length) throw new HttpError(400, 'INVALID_QUERY', 'Query parameters are not supported.'); };

export function createCloudAuth({ db, verifier, allowedOrigins, rateKey }) {
  if (typeof verifier !== 'function' || !db?.query || !allowedOrigins?.length || !rateKey || Buffer.byteLength(rateKey) < 32) throw new Error('Cloud authentication dependencies are required.');
  const origins = new Set(allowedOrigins);
  if ([...origins].some(origin => {
    try { return new URL(origin).origin !== origin || !['http:', 'https:'].includes(new URL(origin).protocol); }
    catch { return true; }
  })) throw new Error('Cloud authentication requires exact allowed origins.');
  async function limit(policy, value, res) {
    const bucket = createHmac('sha256', rateKey).update(policy).update('\0').update(value).digest('hex');
    let row;
    try { row = (await db.query('SELECT allowed,retry_after FROM public.rate_cloud_request($1::text,$2::text)', [policy, bucket])).rows[0]; }
    catch { throw unavailable(); }
    if (!row || typeof row.allowed !== 'boolean') throw unavailable();
    if (!row.allowed) {
      res.set('Retry-After', String(Number.isSafeInteger(row.retry_after) ? Math.max(1, Math.min(900, row.retry_after)) : 60));
      throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many requests. Please try again later.');
    }
  }
  const authenticate = async (req, res, next) => {
    // Never accept a legacy cookie, query token, role header or user metadata as identity.
    const authorization = req.headers.authorization;
    if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(authorization)
        || authorization.length > 16400 || req.rawHeaders.filter((value, i) => i % 2 === 0 && value.toLowerCase() === 'authorization').length !== 1) throw unauthenticated();
    await limit('api-ip', req.ip ?? req.socket.remoteAddress ?? 'unknown', res);
    const verified = await verifier(authorization.slice(7));
    await limit('api-user', verified.subject, res);
    let row;
    try { row = (await db.query('SELECT user_id,username,display_name,role,is_active,auth_version FROM public.resolve_cloud_principal($1::uuid,$2::uuid)',
      [verified.subject, verified.sessionId])).rows[0]; }
    catch (error) { if (error.code === 'PZS01') throw unauthenticated(); throw unavailable(); }
    if (!row || row.is_active !== true || !roles.has(row.role) || !/^[1-9]\d{0,18}$/u.test(String(row.user_id))
        || BigInt(row.user_id) > 9223372036854775807n || !/^\d{1,19}$/u.test(String(row.auth_version))) throw unauthenticated();
    req.principal = { ...identity(row), is_active: true, auth_version: String(row.auth_version) };
    req.cloudSession = verified;
    next();
  };
  const requireRoles = (...allowed) => {
    if (!allowed.length || allowed.some(role => !roles.has(role))) throw new Error('Invalid role policy.');
    return (req, res, next) => {
      if (!req.principal) throw unauthenticated();
      if (!allowed.includes(req.principal.role)) throw new HttpError(403, 'FORBIDDEN', 'This operation is not permitted.');
      next();
    };
  };
  const csrf = (req, res, next) => {
    if (!req.principal || !req.cloudSession) throw unauthenticated();
    if (!origins.has(req.get('Origin'))) throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'Request origin is not permitted.');
    next();
  };
  const emptyBody = req => {
    noQuery(req);
    if (req.body !== undefined && (!req.body || Array.isArray(req.body) || typeof req.body !== 'object' || Object.keys(req.body).length)) {
      throw new HttpError(400, 'INVALID_BODY', 'This operation does not accept fields.');
    }
  };
  const router = Router();
  router.post('/login', authenticate, csrf, (req, res) => { emptyBody(req); res.json({ data: identity(req.principal) }); });
  router.get('/me', authenticate, (req, res) => { noQuery(req); res.json({ data: identity(req.principal) }); });
  router.get('/csrf', authenticate, (req, res) => { noQuery(req); res.json({ data: { mode: 'bearer', csrf_required: false } }); });
  router.post('/logout', authenticate, csrf, async (req, res) => {
    emptyBody(req);
    try { await db.query('SELECT public.revoke_cloud_session($1::uuid,$2::bigint)', [req.cloudSession.sessionId, req.principal.user_id]); }
    catch { throw unavailable(); }
    res.status(204).end();
  });
  return { router, authenticate, requireRoles, csrf,
    // Do not silently change a legacy public hash without changing Supabase Auth.
    async hashPassword() { throw new HttpError(503, 'CLOUD_ACCOUNT_OPERATION_BLOCKED', 'Cloud account provisioning and password changes require the approved provider lifecycle integration.'); },
    async revokeUserSessions() { /* Cloud SQL counter/cutoff transaction is authoritative; no Redis cleanup. */ },
  };
}
