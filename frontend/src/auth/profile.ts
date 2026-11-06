const profile = import.meta.env.VITE_APP_PROFILE ?? 'local-test';
if (!['local-test', 'supabase-cloud'].includes(profile)) throw new Error('Invalid application profile.');
export const isCloud = profile === 'supabase-cloud';
