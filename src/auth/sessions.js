import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from '../http/errors.js';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const validToken = value => typeof value === 'string' && tokenPattern.test(value);
const token = () => randomBytes(32).toString('base64url');

const touchScript = `-- warehouse_session_touch_v1
local raw = redis.call('GET', KEYS[1])
if not raw then return false end
local session = cjson.decode(raw)
local epoch = redis.call('GET', KEYS[2]) or '0'
local now = tonumber(ARGV[1])
local idle = tonumber(ARGV[2])
if tostring(session.epoch) ~= epoch or now < session.issuedAt or now < session.lastSeen
   or now >= session.expiresAt or now-session.lastSeen >= idle then
  redis.call('DEL', KEYS[1])
  return false
end
session.lastSeen = now
local ttl = math.min(idle, session.expiresAt-now)
local next = cjson.encode(session)
redis.call('SET', KEYS[1], next, 'PX', ttl)
return next`;

const revokeScript = `-- warehouse_session_revoke_v1
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return redis.call('GET', KEYS[1])`;

const rateScript = `-- warehouse_login_rate_v1
local values = {}
for i,key in ipairs(KEYS) do
  values[i] = redis.call('INCR', key)
  if values[i] == 1 then redis.call('PEXPIRE', key, ARGV[1]) end
end
return values`;

export function createSessionStore(redis, { idleMs = 1800000, absoluteMs = 28800000, clock = Date.now } = {}) {
  if (!redis || typeof redis.sendCommand !== 'function') throw new Error('A Redis session client is required.');
  if (![idleMs, absoluteMs].every(Number.isSafeInteger) || idleMs < 1 || absoluteMs < idleMs || absoluteMs > 28800000) {
    throw new Error('Invalid session lifetime configuration.');
  }
  const sessionKey = raw => `ssw:p3:session:${digest(raw)}`;
  const epochKey = id => `ssw:p3:session:user:${id}:version`;
  const command = async args => {
    try { return await redis.sendCommand(args); }
    catch { throw new HttpError(503, 'SESSION_STORE_UNAVAILABLE', 'Session storage is unavailable.'); }
  };
  const parse = raw => {
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || !/^\d{1,19}$/u.test(value.userId)
          || !/^\d{1,19}$/u.test(value.authVersion) || !/^\d{1,19}$/u.test(value.epoch)
          || !validToken(value.csrf) || !Number.isSafeInteger(value.issuedAt)
          || !Number.isSafeInteger(value.lastSeen) || !Number.isSafeInteger(value.expiresAt)
          || value.expiresAt - value.issuedAt !== absoluteMs) return null;
      return value;
    } catch { return null; }
  };

  return {
    async create(user) {
      const rawToken = token(), now = clock();
      const epoch = String(await command(['GET', epochKey(user.user_id)]) ?? '0');
      const session = { userId: String(user.user_id), authVersion: String(user.auth_version), epoch,
        csrf: token(), issuedAt: now, lastSeen: now, expiresAt: now + absoluteMs };
      await command(['SET', sessionKey(rawToken), JSON.stringify(session), 'PX', String(idleMs)]);
      return { token: rawToken, session };
    },
    async read(rawToken) {
      if (!validToken(rawToken)) return null;
      const key = sessionKey(rawToken);
      const raw = await command(['GET', key]);
      if (raw === null) return null;
      const initial = parse(raw);
      if (!initial) { await command(['DEL', key]); return null; }
      const touched = await command(['EVAL', touchScript, '2', key, epochKey(initial.userId), String(clock()), String(idleMs)]);
      if (touched === null || touched === false) return null;
      const session = parse(touched);
      if (!session) { await command(['DEL', key]); return null; }
      return session;
    },
    async destroy(rawToken) {
      if (validToken(rawToken)) await command(['DEL', sessionKey(rawToken)]);
    },
    async revokeUserSessions(userId) {
      if (!/^\d{1,19}$/u.test(String(userId))) throw new Error('Invalid internal user identifier.');
      return command(['EVAL', revokeScript, '1', epochKey(userId), String(absoluteMs + 1000)]);
    },
    async rateLimit(username, address) {
      const account = digest(username.toLowerCase()), ip = digest(address);
      const keys = [`ssw:p3:rate:login:pair:${account}:${ip}`, `ssw:p3:rate:login:user:${account}`, `ssw:p3:rate:login:ip:${ip}`];
      const counts = await command(['EVAL', rateScript, '3', ...keys, '900000']);
      return { allowed: Number(counts[0]) <= 5 && Number(counts[1]) <= 20 && Number(counts[2]) <= 100,
        retryAfter: 900, clear: () => command(['DEL', keys[0], keys[1]]) };
    },
  };
}
