import { Injectable } from '@nestjs/common';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { CreateUserRoleDto } from './dto/create-user-role.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UserRoleListQueryDto } from './dto/user-role-list-query.dto';

export interface MyRoleForProject {
  project_id: number;
  role_code: number | null;
}

export interface UserRoleRow {
  user_id: number;
  project_id: number;
  role_code: number;
  status: number;
  created_at: string;
  updated_at: string;
}

interface UserRoleListRow extends UserRoleRow {
  total_count: number;
}

/**
 * 11_PROJECT_API.md 3.1 `GET /user-roles/me` + 12_USER_API.md 3장(User Role) 3개
 * 엔드포인트(생성/목록/수정)의 비즈니스 로직.
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

  /** 12_USER_API.md 3.1 — SUPER_ADMIN 전용. 회사 불일치(30003)/중복 배정(32001)은 SP가 검증한다. */
  async create(dto: CreateUserRoleDto): Promise<UserRoleRow> {
    const { result, data } = await this.spExecutor.callProcedure<UserRoleRow[]>(
      'SP_USER_ROLE_CREATE',
      [dto.user_id, dto.project_id, dto.role_code],
    );

    if (result === 31003) {
      throw new BusinessException(ResultCode.USER_NOT_FOUND);
    }
    if (result === 31002) {
      throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
    }
    if (result === 30003) {
      throw new BusinessException(ResultCode.DISALLOWED_VALUE);
    }
    if (result === 32001) {
      throw new BusinessException(ResultCode.DUPLICATE_DATA);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return data[0];
  }

  /** 12_USER_API.md 3.2 — SUPER_ADMIN 전용, 전부 선택 필터. */
  async list(
    query: UserRoleListQueryDto,
  ): Promise<PaginatedResult<UserRoleRow>> {
    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.spExecutor.callProcedure<
      UserRoleListRow[]
    >('SP_USER_ROLE_LIST', [
      query.user_id ?? null,
      query.project_id ?? null,
      query.role_code ?? null,
      query.status ?? null,
      query.page_size,
      offset,
    ]);

    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const totalCount = rows[0]?.total_count ?? 0;
    const items: UserRoleRow[] = rows.map((row) => ({
      user_id: row.user_id,
      project_id: row.project_id,
      role_code: row.role_code,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return buildPaginatedResult(query, totalCount, items);
  }

  /**
   * 12_USER_API.md 3.3 — SUPER_ADMIN 전용. role_code=10 시도(30003)/배정 없음(31007)은
   * SP_USER_ROLE_UPDATE가 검증한다.
   */
  async update(
    userId: number,
    projectId: number,
    dto: UpdateUserRoleDto,
  ): Promise<UserRoleRow> {
    const { result, data } = await this.spExecutor.callProcedure<UserRoleRow[]>(
      'SP_USER_ROLE_UPDATE',
      [userId, projectId, dto.role_code ?? null, dto.status ?? null],
    );

    if (result === 30003) {
      throw new BusinessException(ResultCode.DISALLOWED_VALUE);
    }
    if (result === 31007) {
      throw new BusinessException(ResultCode.USER_ROLE_NOT_FOUND);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return data[0];
  }
}
