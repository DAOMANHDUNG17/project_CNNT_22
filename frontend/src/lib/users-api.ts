import type { Page, RequestOptions } from './api-types';
import { authorizedGet, authorizedPatch, authorizedPost } from './backend-api';

export type ManagedRole = 'ADMIN' | 'STAFF' | 'VIEWER';
export interface ManagedUser {
  user_id: string; auth_user_id: string; username: string; display_name: string; email: string | null;
  role: ManagedRole; is_active: boolean; created_at: string; updated_at: string;
}
export interface CreateManagedUser { username: string; display_name: string; email: string; password: string; role: ManagedRole; is_active: boolean }
export type PatchManagedUser = Partial<Pick<CreateManagedUser, 'username' | 'display_name' | 'role' | 'is_active'>>;
export interface UsersQuery { page: number; limit: number; q?: string; role?: ManagedRole; isActive?: boolean }

export function listDatabaseUsers(query: UsersQuery, options: RequestOptions = {}): Promise<Page<ManagedUser>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  return authorizedGet(`/users?${params}`, options);
}
export function createDatabaseUser(body: CreateManagedUser): Promise<{ data: ManagedUser }> { return authorizedPost('/users', body); }
export function updateDatabaseUser(id: string, body: PatchManagedUser): Promise<{ data: ManagedUser }> { return authorizedPatch(`/users/${encodeURIComponent(id)}`, body); }
