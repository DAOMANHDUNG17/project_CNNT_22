import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadCloudEnvironment(env = process.env, readFile = readFileSync) {
  if (!env.APP_ENV_FILE) throw new Error('Cloud requires an explicit APP_ENV_FILE; see infra/supabase/cloud.env.example.');
  const path = resolve(env.APP_ENV_FILE);
  const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
  if (path.toLowerCase() === rootEnv.toLowerCase()) throw new Error('Cloud must not load the local main .env.');
  let parsed;
  try {
    const text = readFile(path, 'utf8');
    if (Buffer.byteLength(text) > 65536) throw new Error();
    parsed = parseEnv(text);
  } catch { throw new Error('Cannot read the explicit Cloud environment file.'); }
  if (parsed.APP_PROFILE !== 'supabase-cloud') throw new Error('Cloud environment file must declare APP_PROFILE=supabase-cloud.');
  // The explicitly selected file is authoritative over stale shell PG/Redis values.
  const inherited = { ...env };
  // An omitted credential must not silently come from another project's shell.
  for (const name of Object.keys(inherited)) {
    if (/^(?:PG|WRITE_PG|SUPABASE_|CLOUD_|VITE_)/u.test(name)
        || ['APP_PROFILE','ALLOWED_ORIGINS','HOST','PORT'].includes(name)) delete inherited[name];
  }
  const selected = { ...inherited, ...parsed };
  for (const name of ['PGPASSWORD_FILE', 'WRITE_PGPASSWORD_FILE', 'CLOUD_RATE_HMAC_KEY_FILE', 'PGSSLROOTCERT']) {
    if (parsed[name]) selected[name] = resolve(dirname(path), parsed[name]);
  }
  return selected;
}
