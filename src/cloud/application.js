import { createApp } from '../app.js';
import { createCloudAuth } from './auth.js';
import { createJwtVerifier } from './jwt.js';

// Dependency injection permits offline HTTP/RBAC verification without opening pools.
export function createCloudApplication({ config, reader, writer, authClient, keyResolver, logger = console }) {
  const verifier = createJwtVerifier(config.auth, { authClient, keyResolver });
  const auth = createCloudAuth({ db: writer, verifier, allowedOrigins: config.allowedOrigins, rateKey: config.rateKey });
  return createApp({ db: reader, writerDb: writer, auth, schema: 'public', logger });
}
