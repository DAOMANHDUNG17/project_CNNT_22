import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { AuthenticatedRequest, BusinessUser, Role } from './auth.types';
import { JwtVerifierService } from './jwt-verifier.service';

const validRoles: readonly Role[] = ['ADMIN', 'STAFF', 'VIEWER'];

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtVerifier: JwtVerifierService,
    private readonly databaseService: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = /^Bearer ([^\s]+)$/i.exec(
      request.headers.authorization ?? '',
    )?.[1];
    if (!token) {
      throw new UnauthorizedException();
    }

    let authUserId: string;
    try {
      authUserId = await this.jwtVerifier.verify(token);
    } catch {
      throw new UnauthorizedException();
    }

    let users;
    try {
      users = await this.databaseService.query(
        'SELECT user_id, auth_user_id, username, display_name, role, is_active FROM public.users WHERE auth_user_id = $1 LIMIT 1',
        [authUserId],
      );
    } catch {
      throw new ServiceUnavailableException('Authentication data unavailable');
    }

    const user = users[0];
    if (!user || user.is_active !== true || !validRoles.includes(user.role)) {
      throw new ForbiddenException();
    }

    request.user = {
      user_id: user.user_id,
      auth_user_id: user.auth_user_id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      is_active: user.is_active,
    } as BusinessUser;
    return true;
  }
}
