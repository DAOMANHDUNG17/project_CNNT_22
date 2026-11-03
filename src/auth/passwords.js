import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from '../http/errors.js';

const derive = promisify(argon2);
const defaults = Object.freeze({ memory: 19456, passes: 2, parallelism: 1, tagLength: 32 });
let active = 0;
const waiting = [];

async function boundedDerive(password, salt, parameters) {
  if (active >= 2) {
    if (waiting.length >= 16) throw new HttpError(503, 'AUTHENTICATION_BUSY', 'Authentication is temporarily busy.');
    await new Promise(resolve => waiting.push(resolve));
  } else active++;
  try {
    return await derive('argon2id', { message: password, nonce: salt, ...parameters });
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

export function validateNewPassword(password) {
  if (typeof password !== 'string' || [...password].length < 12 || [...password].length > 128
      || Buffer.byteLength(password, 'utf8') > 512 || password.includes('\0')) {
    throw new HttpError(400, 'INVALID_BODY', 'Password must contain 12 to 128 characters.');
  }
  return password;
}

function loginPasswordValid(password) {
  return typeof password === 'string' && password.length > 0 && [...password].length <= 128
    && Buffer.byteLength(password, 'utf8') <= 512 && !password.includes('\0');
}

export async function hashPassword(password) {
  validateNewPassword(password);
  const salt = randomBytes(16);
  const result = await boundedDerive(password, salt, defaults);
  const b64 = value => value.toString('base64').replace(/=+$/u, '');
  return `$argon2id$v=19$m=${defaults.memory},t=${defaults.passes},p=${defaults.parallelism}$${b64(salt)}$${b64(result)}`;
}

function parseHash(encoded) {
  if (typeof encoded !== 'string' || encoded.length > 256) return null;
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/u.exec(encoded);
  if (!match) return null;
  const memory = Number(match[1]), passes = Number(match[2]), parallelism = Number(match[3]);
  // Never let untrusted or corrupt stored parameters exhaust server memory/CPU.
  if (memory < 19456 || memory > 65536 || passes < 2 || passes > 6 || parallelism < 1 || parallelism > 4) return null;
  const salt = Buffer.from(match[4], 'base64'), expected = Buffer.from(match[5], 'base64');
  if (salt.length !== 16 || expected.length !== 32
      || salt.toString('base64').replace(/=+$/u, '') !== match[4]
      || expected.toString('base64').replace(/=+$/u, '') !== match[5]) return null;
  return { salt, expected, parameters: { memory, passes, parallelism, tagLength: 32 } };
}

const dummySalt = randomBytes(16);

export async function verifyPassword(password, encoded) {
  if (!loginPasswordValid(password)) return false;
  const parsed = parseHash(encoded);
  const result = await boundedDerive(password, parsed?.salt ?? dummySalt, parsed?.parameters ?? defaults);
  return parsed !== null && timingSafeEqual(result, parsed.expected);
}
