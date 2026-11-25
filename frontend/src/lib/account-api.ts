import type { Identity, RequestOptions } from './api-types';
import { authorizedGet, authorizedPatch } from './backend-api';

export interface AccountProfile extends Identity { email: string }
export interface PasswordInput { new_password: string; confirm_password: string }
export interface OwnPasswordInput extends PasswordInput { current_password: string }
export interface PasswordResult { changed: boolean; requires_relogin: boolean; refresh_sessions_revoked: boolean }
export const accountProfile = (options: RequestOptions = {}) => authorizedGet<AccountProfile>('/account', options);
export const changeOwnPassword = (body: OwnPasswordInput) => authorizedPatch<PasswordResult>('/account/password', body);
export const resetAccountPassword = (id: string, body: PasswordInput) => authorizedPatch<PasswordResult>(`/users/${encodeURIComponent(id)}/password`, body);

export const newPasswordRules = [{ required: true, message: 'Nhập mật khẩu mới.' }, {
  validator: (_: unknown, value: unknown) => typeof value === 'string' && [...value].length >= 8 && [...value].length <= 128
    ? Promise.resolve() : Promise.reject(new Error('Mật khẩu mới phải có 8–128 ký tự.')),
}];
