import { SetMetadata } from '@nestjs/common';
import { RoleCode } from './role-code.enum';

export const ROLES_KEY = 'roles';

/**
 * 핸들러/컨트롤러에 허용된 `RoleCode` 목록을 메타데이터로 부착한다. `RolesGuard`가 이 값을
 * 읽어 `request.user.roleCode`가 목록에 있는지만 확인하는 화이트리스트 방식이다 — 이 데코레이터가
 * 없는 라우트는 `RolesGuard`를 걸어도 전체 역할이 통과한다(role-code.enum.ts 참고).
 *
 * @author trisakion
 */
export const Roles = (...roles: RoleCode[]) => SetMetadata(ROLES_KEY, roles);
