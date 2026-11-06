import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { HttpError } from '../http/errors.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const denied = () => new HttpError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
const unavailable = () => new HttpError(503, 'AUTH_PROVIDER_UNAVAILABLE', 'Authentication is temporarily unavailable.');

export function createJwtVerifier(config, { keyResolver, authClient, clock = Date.now } = {}) {
  if (!config?.issuer || config.audience !== 'authenticated'
      || !(config.verification === 'jwks' && ['RS256', 'ES256'].includes(config.algorithm)
        || config.verification === 'auth-server' && config.algorithm === 'HS256')) throw new Error('Invalid JWT verification policy.');
  const keys = config.verification === 'jwks' ? keyResolver ?? createRemoteJWKSet(new URL(config.jwksUrl), {
    timeoutDuration: config.timeoutMs, cooldownDuration: 30000, cacheMaxAge: 300000,
  }) : null;
  if (!keys && typeof authClient?.auth?.getClaims !== 'function') throw new Error('Auth-server verification requires the official Auth client.');
  return async token => {
    if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) throw denied();
    let header;
    try { header = decodeProtectedHeader(token); } catch { throw denied(); }
    if (header.alg !== config.algorithm || header.jku || header.x5u || header.jwk) throw denied();
    let claims;
    const now = Math.floor(clock() / 1000);
    if (keys) {
      try {
        ({ payload: claims } = await jwtVerify(token, keys, { algorithms: [config.algorithm], issuer: config.issuer,
          audience: config.audience, requiredClaims: ['sub', 'session_id', 'iat', 'exp'],
          currentDate: new Date(now * 1000), clockTolerance: 5 }));
      } catch (error) {
        if (['ERR_JWKS_TIMEOUT', 'ERR_JWKS_INVALID'].includes(error.code)
            || error instanceof TypeError || error.code === 'ERR_JOSE_GENERIC') throw unavailable();
        throw denied();
      }
    } else {
      let response;
      try { response = await authClient.auth.getClaims(token); } catch { throw unavailable(); }
      if (!response || typeof response !== 'object') throw unavailable();
      if (response.error) {
        if (!response.error.status || response.error.status >= 500 || response.error.status === 429) throw unavailable();
        throw denied();
      }
      claims = response.data?.claims;
    }
    const audience = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
    if (!claims || claims.iss !== config.issuer || !audience.includes(config.audience)
        || !Number.isSafeInteger(claims.exp) || claims.exp <= now - 5
        || !Number.isSafeInteger(claims.iat) || claims.iat > now + 5 || claims.iat >= claims.exp
        || (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + 5))
        || typeof claims.sub !== 'string' || !uuid.test(claims.sub)
        || typeof claims.session_id !== 'string' || !uuid.test(claims.session_id)
        || claims.role !== 'authenticated' || claims.is_anonymous === true) throw denied();
    return { subject: claims.sub.toLowerCase(), sessionId: claims.session_id.toLowerCase() };
  };
}
