// OFFLINE validation only. This module does not import pg, Auth SDK or fetch.
import { existsSync } from 'node:fs';
import { loadCloudEnvironment } from './lib/cloud-environment.js';
import { readCloudConfig } from '../src/config/cloud.js';

try {
  const env = loadCloudEnvironment();
  const missing = [];
  for (const name of ['APP_PROFILE','SUPABASE_PROJECT_REF','SUPABASE_EXPECTED_PROJECT_REF','SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY','SUPABASE_JWT_VERIFICATION','SUPABASE_JWT_ALGORITHM','SUPABASE_DB_MODE',
    'PGHOST','PGDATABASE','PGUSER','WRITE_PGUSER','ALLOWED_ORIGINS']) {
    if (!env[name] || env[name].startsWith('REPLACE_')) missing.push(name);
  }
  for (const name of ['PGPASSWORD','WRITE_PGPASSWORD','CLOUD_RATE_HMAC_KEY']) {
    if (env[name+'_FILE'] ? !existsSync(env[name+'_FILE']) : !env[name]) missing.push(name+'_FILE (missing file) or '+name);
  }
  if (!env.PGSSLROOTCERT || !existsSync(env.PGSSLROOTCERT)) missing.push('PGSSLROOTCERT (missing CA file)');
  if (missing.length) {
    console.error('Cloud configuration is incomplete (OFFLINE; no connection attempted):');
    for (const name of missing) console.error(`- ${name}`);
    process.exitCode = 1;
  } else {
    readCloudConfig(env);
    console.info('Cloud configuration passed OFFLINE validation. Credentials/TLS/provider/DB are NOT verified; activation remains gated.');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
