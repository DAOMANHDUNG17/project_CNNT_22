import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL and a Supabase publishable or public anon key are required');
}

export const supabase = createClient(url, key);
