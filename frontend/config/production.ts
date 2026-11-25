function publicHttpsOrigin(
  value: string | undefined,
  variable: string,
  allowApi = false,
) {
  const input = value?.trim() ?? '';
  const url = /^https:\/\/[^/?#@\\\s]+(?:\/api)?\/?$/.test(input)
    ? URL.parse(input)
    : null;
  const host = url?.hostname.replace(/\.$/, '');
  if (
    !url ||
    !host ||
    !/^(?:[a-z\d-]+\.)+[a-z][a-z\d-]*$/i.test(host) ||
    /(?:^|\.)(localhost|local)$/.test(host) ||
    (url.pathname !== '/' &&
      (!allowApi || !['/api', '/api/'].includes(url.pathname)))
  ) {
    throw new Error(
      variable +
        ' must be a public HTTPS origin' +
        (allowApi ? ' with an optional /api suffix' : ''),
    );
  }
  return url.origin;
}

function isAnonKey(key: string) {
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) return false;
  try {
    const payload = Buffer.from(key.split('.')[1]!, 'base64url').toString();
    return JSON.parse(payload)?.role === 'anon';
  } catch {
    return false;
  }
}

export function productionConfig(env: Record<string, string | undefined>) {
  const apiUrl =
    publicHttpsOrigin(env.VITE_API_URL, 'VITE_API_URL', true) + '/api';
  const supabaseUrl = publicHttpsOrigin(
    env.VITE_SUPABASE_URL,
    'VITE_SUPABASE_URL',
  );
  const supabaseKey =
    env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    env.VITE_SUPABASE_ANON_KEY?.trim() ||
    '';
  if (!/^sb_publishable_[\w-]+$/.test(supabaseKey) && !isAnonKey(supabaseKey)) {
    throw new Error(
      'VITE_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY must be a Supabase public key',
    );
  }
  return { apiUrl, supabaseUrl, supabaseKey };
}
