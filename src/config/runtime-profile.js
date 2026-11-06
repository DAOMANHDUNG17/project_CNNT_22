export function readRuntimeProfile(env = process.env) {
  const profile = env.APP_PROFILE ?? 'local-test';
  if (!['local-test', 'supabase-cloud'].includes(profile)) throw new Error('APP_PROFILE must be local-test or supabase-cloud.');
  return profile;
}
