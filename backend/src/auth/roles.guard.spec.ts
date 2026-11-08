import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from './auth.types';
import { ROLES_KEY } from './roles.decorator';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  function contextFor(role?: Role, requiredRoles?: Role[]) {
    const handler = () => undefined;
    if (requiredRoles)
      Reflect.defineMetadata(ROLES_KEY, requiredRoles, handler);
    return {
      getHandler: () => handler,
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
    } as ExecutionContext;
  }

  it('allows authenticated VIEWER when no role is declared', () => {
    expect(guard.canActivate(contextFor('VIEWER'))).toBe(true);
  });

  it('allows a matching ADMIN role', () => {
    expect(guard.canActivate(contextFor('ADMIN', ['ADMIN', 'STAFF']))).toBe(
      true,
    );
  });

  it('returns 403 for insufficient role', () => {
    expect(() => guard.canActivate(contextFor('STAFF', ['ADMIN']))).toThrow(
      ForbiddenException,
    );
  });

  it('requires an authenticated user', () => {
    expect(() => guard.canActivate(contextFor())).toThrow(
      UnauthorizedException,
    );
  });
});
