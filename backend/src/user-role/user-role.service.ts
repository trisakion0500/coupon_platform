import { Injectable } from '@nestjs/common';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';

export interface MyRoleForProject {
  project_id: number;
  role_code: number | null;
}

/**
 * 11_PROJECT_API.md 3.1 `GET /user-roles/me` — 헤더에서 선택된 프로젝트에 대한 호출자의
 * 실제 role_code 조회.
 *
 * @author trisakion
 */
@Injectable()
export class UserRoleService {
  constructor(private readonly spExecutor: SpExecutorService) {}

  /**
   * SUPER_ADMIN은 user_role 배정 여부와 무관하게 항상 role_code:10이라(11_PROJECT_API.md 3.1
   * Business Rules) DB를 조회하지 않고 즉시 반환한다. 그 외 role은 활성 배정이 없으면
   * role_code:null(오류가 아님).
   */
  async getMyRoleForProject(
    userId: number,
    roleCode: RoleCode,
    projectId: number,
  ): Promise<MyRoleForProject> {
    if (roleCode === RoleCode.SUPER_ADMIN) {
      return { project_id: projectId, role_code: RoleCode.SUPER_ADMIN };
    }

    const { result, data } = await this.spExecutor.callProcedure<
      Array<{ role_code: number }>
    >('SP_USER_ROLE_GET_BY_PROJECT', [userId, projectId]);

    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return { project_id: projectId, role_code: data?.[0]?.role_code ?? null };
  }
}
