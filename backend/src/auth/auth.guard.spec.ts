import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuthGuard } from './auth.guard';
import type { BusinessUser } from './auth.types';
import { JwtVerifierService } from './jwt-verifier.service';

describe('AuthGuard', () => {
  const authUserId = '11111111-1111-4111-8111-111111111111';
  const businessUser: BusinessUser = {
    user_id: '42',
    auth_user_id: authUserId,
    username: 'warehouse-admin',
    display_name: 'Warehouse Admin',
    role: 'ADMIN',
    is_active: true,
  };
  const verify = jest.fn();
  const query = jest.fn();
  const guard = new AuthGuard(
    { verify } as unknown as JwtVerifierService,
    { query } as unknown as DatabaseService,
  );

  function requestContext(authorization?: string) {
    const request: {
      headers: { authorization?: string };
      user?: BusinessUser;
    } = { headers: { authorization } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
    return { context, request };
  }

  beforeEach(() => {
    verify.mockReset().mockResolvedValue(authUserId);
    query.mockReset().mockResolvedValue([businessUser]);
  });

  it('returns 401 without a Bearer token', async () => {
    const { context } = requestContext();
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid token', async () => {
    verify.mockRejectedValue(new Error('invalid signature'));
    const { context } = requestContext('Bearer invalid-token');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 403 when the business user does not exist', async () => {
    query.mockResolvedValue([]);
    const { context } = requestContext('Bearer valid-token');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('returns 403 when the business user is inactive', async () => {
    query.mockResolvedValue([{ ...businessUser, is_active: false }]);
    const { context } = requestContext('Bearer valid-token');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('attaches only the six business user fields after verification', async () => {
    const { context, request } = requestContext('Bearer valid-token');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE auth_user_id = $1'),
      [authUserId],
    );
    expect(request.user).toEqual(businessUser);
  });
});
