import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, generateKeyPair } from 'jose';
import { randomUUID } from 'node:crypto';
import { createJwtVerifier } from '../src/cloud/jwt.js';

const now = 1800000000;
const config = { issuer: 'https://synthetic.supabase.co/auth/v1', audience: 'authenticated', verification: 'jwks', algorithm: 'ES256' };
const keys = await generateKeyPair('ES256');
const claims = () => ({ sub: randomUUID(), session_id: randomUUID(), iss: config.issuer, aud: 'authenticated',
  role: 'authenticated', iat: now - 30, exp: now + 600 });
const sign = (payload, key = keys.privateKey) => new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: 'synthetic' }).sign(key);
const verify = createJwtVerifier(config, { keyResolver: keys.publicKey, clock: () => now * 1000 });

test('Cloud JWT verifies a real offline signature and returns only trusted subject/session IDs', async () => {
  const payload = { ...claims(), user_metadata: { role: 'ADMIN' } };
  assert.deepEqual(await verify(await sign(payload)), { subject: payload.sub, sessionId: payload.session_id });
});
test('Cloud JWT rejects invalid signatures, expiry, issuer, audience, role, anonymous and malformed identifiers', async () => {
  const other = await generateKeyPair('ES256');
  await assert.rejects(verify(await sign(claims(), other.privateKey)), { status: 401 });
  for (const patch of [{ exp: now - 60 }, { iss: 'https://attacker.invalid' }, { aud: 'service_role' },
    { role: 'service_role' }, { is_anonymous: true }, { sub: '1' }, { session_id: null }, { iat: now + 60 }, { nbf: now + 60 }]) {
    await assert.rejects(verify(await sign({ ...claims(), ...patch })), { status: 401 });
  }
  for (const token of ['', 'not.a.token', 'x'.repeat(20000)]) await assert.rejects(verify(token), { status: 401 });
  const noExpiry = claims(); delete noExpiry.exp;
  await assert.rejects(verify(await sign(noExpiry)), { status: 401 });
});
test('Cloud verifier does not fall back on JWKS outage or trust a token-specified key endpoint', async () => {
  const outage = createJwtVerifier(config, { keyResolver() { throw new TypeError('secret network detail'); }, clock: () => now * 1000 });
  await assert.rejects(outage(await sign(claims())), error => error.status === 503 && !error.message.includes('secret'));
  const redirected = await new SignJWT(claims()).setProtectedHeader({ alg: 'ES256', jku: 'https://attacker.invalid/jwks' }).sign(keys.privateKey);
  await assert.rejects(verify(redirected), { status: 401 });
});
test('HS256 mode requires official server verification and still checks issuer/audience/expiry', async () => {
  const payload = claims();
  const token = await new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32).fill(7));
  let calls = 0;
  const remote = createJwtVerifier({ ...config, verification: 'auth-server', algorithm: 'HS256' }, {
    authClient: { auth: { async getClaims(received) { calls++; assert.equal(received, token); return { data: { claims: payload }, error: null }; } } }, clock: () => now * 1000,
  });
  await remote(token); assert.equal(calls, 1);
  payload.iss = 'https://wrong.invalid'; await assert.rejects(remote(token), { status: 401 });
  const failed = createJwtVerifier({ ...config, verification: 'auth-server', algorithm: 'HS256' }, {
    authClient: { auth: { async getClaims() { return { error: { status: 503 } }; } } },
  });
  await assert.rejects(failed(token), { status: 503 });
});
