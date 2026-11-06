import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '../../../docs/api-client';
import { isCloud } from './profile';

let client: SupabaseClient | undefined;
export function cloudClient() {
  if (!isCloud) throw new Error('Cloud Auth is unavailable in this profile.');
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !/^https:\/\/[a-z]{20}\.supabase\.co$/u.test(url)
      || !key || !/^sb_publishable_[A-Za-z0-9_-]{16,}$/u.test(key)) throw new Error('Missing public Cloud Auth configuration.');
  // Explicit per-tab storage. Never fall back to localStorage when storage is denied.
  const storage = window.sessionStorage;
  client = createClient(url, key, { auth: {
    storage, storageKey: `warehouse-auth-${new URL(url).hostname}`,
    persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
  } });
  return client;
}
export async function accessToken(): Promise<string | null> {
  // This local SDK session is a transport credential, never evidence of RBAC.
  const { data, error } = await cloudClient().auth.getSession();
  if (error) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Không thể làm mới phiên đăng nhập.');
  return data.session?.access_token ?? null;
}
