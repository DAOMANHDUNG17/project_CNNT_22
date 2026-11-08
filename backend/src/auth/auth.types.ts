import type { Request } from 'express';

export type Role = 'ADMIN' | 'STAFF' | 'VIEWER';

export interface BusinessUser {
  user_id: string | number;
  auth_user_id: string;
  username: string;
  display_name: string | null;
  role: Role;
  is_active: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: BusinessUser;
}
