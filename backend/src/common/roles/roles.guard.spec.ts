import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BusinessException } from '../response/business.exception';
import { ResultCode } from '../response/result-code.enum';
import {
  AuthenticatedRequest,
  AuthenticatedUser,
} from '../jwt-auth/jwt-auth.guard';
import { RoleCode } from './role-code.enum';
import { RolesGuard } from './roles.guard';

function buildContext(user: AuthenticatedUser | undefined): {
  context: ExecutionContext;
  getAllAndOverride: jest.Mock;
} {
  const request: Partial<AuthenticatedRequest> = { user };
  const getAllAndOverride = jest.fn();
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { context, getAllAndOverride };
}

describe('RolesGuard', () => {
  const superAdmin: AuthenticatedUser = {
    userId: 1,
    companyId: 1,
    roleCode: RoleCode.SUPER_ADMIN,
    jti: 'jti-1',
  };
  const operator: AuthenticatedUser = {
    userId: 2,
    companyId: 2,
    roleCode: RoleCode.OPERATOR,
    jti: 'jti-2',
  };

  function buildGuard(allowedRoles: RoleCode[] | undefined): {
    guard: RolesGuard;
  } {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(allowedRoles),
    };
    return { guard: new RolesGuard(reflector as unknown as Reflector) };
  }

  it('allows the request when no @Roles metadata is set', () => {
    const { guard } = buildGuard(undefined);
    const { context } = buildContext(operator);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows the request when the user role is in the whitelist', () => {
    const { guard } = buildGuard([RoleCode.SUPER_ADMIN]);
    const { context } = buildContext(superAdmin);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws PERMISSION_DENIED when the user role is not in the whitelist', () => {
    const { guard } = buildGuard([RoleCode.SUPER_ADMIN]);
    const { context } = buildContext(operator);

    expect(() => guard.canActivate(context)).toThrow(
      new BusinessException(ResultCode.PERMISSION_DENIED),
    );
  });

  it('throws PERMISSION_DENIED when request.user is missing', () => {
    const { guard } = buildGuard([RoleCode.SUPER_ADMIN]);
    const { context } = buildContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(
      new BusinessException(ResultCode.PERMISSION_DENIED),
    );
  });
});
