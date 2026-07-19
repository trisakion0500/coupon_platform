import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../jwt-auth/jwt-auth.guard';
import { BusinessException } from '../response/business.exception';
import { ResultCode } from '../response/result-code.enum';
import { ROLES_KEY } from './roles.decorator';
import { RoleCode } from './role-code.enum';

/**
 * `@Roles(...)`로 지정된 화이트리스트에 `request.user.roleCode`가 포함되는지 확인하는 권한 가드.
 * 반드시 `JwtAuthGuard` 다음 순서로 적용해야 한다(`request.user`가 그 가드에서 채워짐).
 * `@Roles`가 없는 라우트는 이 가드를 걸어도 전체 역할을 통과시킨다 — 그런 라우트는 애초에
 * `RolesGuard`를 붙일 필요가 없지만(예: 헤더 선택용 API는 JwtAuthGuard만 사용), 방어적으로
 * "메타데이터 없으면 통과"를 기본값으로 둔다.
 *
 * @author trisakion
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowedRoles = this.reflector.getAllAndOverride<RoleCode[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!allowedRoles || allowedRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user || !allowedRoles.includes(request.user.roleCode)) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }

    return true;
  }
}
