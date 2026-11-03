import { Router } from 'express';
import pg from 'pg';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../http/errors.js';
import { createSessionStore, validToken } from './sessions.js';
import { hashPassword, verifyPassword } from './passwords.js';

export { hashPassword, verifyPassword, validateNewPassword } from './passwords.js';

const roles = new Set(['ADMIN', 'KEEPER', 'STAFF', 'VIEWER']);
const identity = row => ({ user_id: String(row.user_id), username: row.username,
  display_name: row.display_name, role: row.role });
const unauthenticated = () => new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
const noQuery = req => { if (Object.keys(req.query ?? {}).length) throw new HttpError(400, 'INVALID_QUERY', 'Query parameters are not supported.'); };

export function createAuth({ db, schema = 'public', redis, config = {} }) {
  const allowedOrigins = new Set(config.allowedOrigins ?? []);
  if (!allowedOrigins.size || [...allowedOrigins].some(value => {
    try { return new URL(value).origin !== value || !['http:', 'https:'].includes(new URL(value).protocol); }
    catch { return true; }
  })) throw new Error('Authentication requires explicit allowed origins.');
  const secure = config.secureCookies === true;
  const name = config.cookieName ?? (secure ? '__Host-warehouse_session' : 'warehouse_session');
  if (!/^[A-Za-z0-9_-]{1,80}$/u.test(name) || (name.startsWith('__Host-') && !secure)) throw new Error('Invalid session cookie configuration.');
  const absoluteMs = config.absoluteMs ?? 28800000;
  const sessions = createSessionStore(redis, config);
  const table = `${pg.escapeIdentifier(schema)}.${pg.escapeIdentifier('users')}`;
  const cookie = (res, value, maxAge) => res.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  const readCookie = req => {
    const header = req.headers.cookie;
    if (typeof header !== 'string' || header.length > 8192) return null;
    const values = header.split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
    if (values.length !== 1) return null;
    const result = values[0].slice(name.length + 1);
    return validToken(result) ? result : null;
  };
  const csrfMatches = (req, session) => {
    const received = req.get('X-CSRF-Token');
    return validToken(received) && timingSafeEqual(Buffer.from(received), Buffer.from(session.csrf));
  };
  const requireOrigin = (req, res, next) => {
    if (!allowedOrigins.has(req.get('Origin'))) throw new HttpError(403, 'ORIGIN_FORBIDDEN', 'Request origin is not permitted.');
    next();
  };
  const csrf = (req, res, next) => {
    if (!req.authSession) throw unauthenticated();
    if (!allowedOrigins.has(req.get('Origin')) || !csrfMatches(req, req.authSession)) {
      throw new HttpError(403, 'CSRF_FAILED', 'CSRF verification failed.');
    }
    next();
  };
  const authenticate = async (req, res, next) => {
    const rawToken = readCookie(req);
    const session = rawToken ? await sessions.read(rawToken) : null;
    if (!session) { if (rawToken) cookie(res, '', 0); throw unauthenticated(); }
    const row = (await db.query(`SELECT user_id,username,display_name,role,is_active,auth_version FROM ${table} WHERE user_id=$1`, [session.userId])).rows[0];
    if (!row || !row.is_active || !roles.has(row.role) || String(row.auth_version) !== session.authVersion) {
      await sessions.destroy(rawToken);
      cookie(res, '', 0);
      throw unauthenticated();
    }
    req.principal = { ...identity(row), is_active: true, auth_version: String(row.auth_version) };
    req.authSession = session;
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
  const router = Router();
  router.post('/login', requireOrigin, async (req, res) => {
    noQuery(req);
    if (!req.is('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.');
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 2
        || Object.keys(body).some(key => !['username', 'password'].includes(key))
        || typeof body.username !== 'string' || !body.username || body.username !== body.username.trim()
        || [...body.username].length > 50 || body.username.includes('\0')
        || typeof body.password !== 'string' || !body.password || [...body.password].length > 128
        || Buffer.byteLength(body.password, 'utf8') > 512 || body.password.includes('\0')) {
      throw new HttpError(400, 'INVALID_BODY', 'Invalid login request.');
    }
    const rate = await sessions.rateLimit(body.username, req.ip ?? req.socket?.remoteAddress ?? 'unknown');
    if (!rate.allowed) {
      res.set('Retry-After', String(rate.retryAfter));
      throw new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many login attempts. Please try again later.');
    }
    const row = (await db.query(`SELECT user_id,username,display_name,role,password_hash,is_active,auth_version FROM ${table} WHERE username=$1`, [body.username])).rows[0];
    const valid = await verifyPassword(body.password, row?.password_hash);
    if (!row || !row.is_active || !roles.has(row.role) || !valid) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    await rate.clear();
    const issued = await sessions.create(row);
    await sessions.destroy(readCookie(req));
    cookie(res, issued.token, Math.floor(absoluteMs / 1000));
    res.json({ data: identity(row) });
  });
  router.get('/me', authenticate, (req, res) => { noQuery(req); res.json({ data: identity(req.principal) }); });
  router.get('/csrf', authenticate, (req, res) => { noQuery(req); res.json({ data: { csrf_token: req.authSession.csrf } }); });
  router.post('/logout', requireOrigin, async (req, res) => {
    noQuery(req);
    if (req.body && (typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) {
      throw new HttpError(400, 'INVALID_BODY', 'Logout does not accept a request body.');
    }
    const rawToken = readCookie(req);
    const session = rawToken ? await sessions.read(rawToken) : null;
    if (session && !csrfMatches(req, session)) throw new HttpError(403, 'CSRF_FAILED', 'CSRF verification failed.');
    await sessions.destroy(rawToken);
    cookie(res, '', 0);
    res.status(204).end();
  });
  return { router, authenticate, requireRoles, csrf, requireOrigin,
    revokeUserSessions: sessions.revokeUserSessions, hashPassword, verifyPassword };
}
