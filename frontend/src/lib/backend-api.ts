import { ApiError } from './api-types';
import type { RequestOptions } from './api-types';
import { supabase } from './supabase';

export async function authorizedGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Không thể đọc phiên đăng nhập.');
  if (!data.session) throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Vui lòng đăng nhập.');

  const apiUrl = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api').replace(/\/$/, '');
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
    signal: options.signal,
  });
  if (!response.ok) {
    const code = response.status === 401 ? 'AUTHENTICATION_REQUIRED'
      : response.status === 403 ? 'FORBIDDEN' : 'REQUEST_FAILED';
    throw new ApiError(response.status, code, 'Không tải được dữ liệu từ backend.');
  }
  return (await response.json()) as T;
}
