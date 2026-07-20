import { Injectable } from '@nestjs/common';
import { AuditAction } from '../common/audit-log/audit-action.enum';
import { AuditLogService } from '../common/audit-log/audit-log.service';
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

/**
 * SP_USER_ROLE_LIST 반환 행 — 요청한 page가 데이터 범위를 벗어나면 user_id를 비롯한 모든
 * 데이터 컬럼이 NULL인 채로 total_count만 채워진 행 1개가 온다(LEFT JOIN ... ON TRUE).
 */
interface UserRoleListRow extends Omit<UserRoleRow, 'user_id'> {
  user_id: number | null;
  total_count: number;
}

/**
 * SP_USER_ROLE_CREATE 반환 행 — 감사로그(log_audit)용 company_id(project 조인)/user_name/
 * project_name/after_json/requester_name이 추가로 온다. user_role은 company_id 컬럼이
 * 없어 project 테이블 조인으로 얻는다(SP 주석 참고).
 */
interface UserRoleCreateRow extends UserRoleRow {
  company_id: number;
  user_name: string;
  project_name: string;
  after_json: Record<string, unknown>;
  requester_name: string | null;
}

/** SP_USER_ROLE_UPDATE 반환 행 — UserRoleCreateRow + before_json. */
interface UserRoleUpdateRow extends UserRoleCreateRow {
  before_json: Record<string, unknown>;
}

/**
 * 11_PROJECT_API.md 3.1 `GET /user-roles/me` + 12_USER_API.md 3장(User Role) 3개
 * 엔드포인트(생성/목록/수정)의 비즈니스 로직.
 *
 * @author trisakion
 */
@Injectable()
export class UserRoleService {
  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly auditLog: AuditLogService,
  ) {}

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

  /**
   * 12_USER_API.md 3.1 — SUPER_ADMIN 전용(RolesGuard). SP도 FN_IS_SUPER_ADMIN으로 호출자를
   * 재확인한다(20001, 방어적 이중 체크 - 02_DEV_CONVENTIONS.md 3.2). 회사 불일치(30003)/중복
   * 배정(32001)도 SP가 검증한다.
   */
  async create(
    dto: CreateUserRoleDto,
    requesterUserId: number,
  ): Promise<UserRoleRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      UserRoleCreateRow[]
    >('SP_USER_ROLE_CREATE', [
      dto.user_id,
      dto.project_id,
      dto.role_code,
      requesterUserId,
    ]);

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
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

    const row = data[0];
    void this.auditLog.record({
      action: AuditAction.CREATE,
      companyId: row.company_id,
      projectId: row.project_id,
      tableName: 'user_role',
      targetId: JSON.stringify({
        user_id: row.user_id,
        project_id: row.project_id,
      }),
      targetName: `${row.user_name} (${row.project_name})`,
      beforeJson: null,
      afterJson: row.after_json,
      createdBy: requesterUserId,
      createdByName: row.requester_name,
    });

    return {
      user_id: row.user_id,
      project_id: row.project_id,
      role_code: row.role_code,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  /** 12_USER_API.md 3.2 — SUPER_ADMIN 전용(RolesGuard + SP의 FN_IS_SUPER_ADMIN 재확인), 전부 선택 필터. */
  async list(
    query: UserRoleListQueryDto,
    requesterUserId: number,
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
      requesterUserId,
    ]);

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const totalCount = rows[0]?.total_count ?? 0;
    const items: UserRoleRow[] = rows
      .filter(
        (row): row is UserRoleListRow & { user_id: number } =>
          row.user_id !== null,
      )
      .map((row) => ({
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
   * 12_USER_API.md 3.3 — SUPER_ADMIN 전용(RolesGuard + SP의 FN_IS_SUPER_ADMIN 재확인, 20001).
   * role_code=10 시도(30003)/배정 없음(31007)은 SP_USER_ROLE_UPDATE가 검증한다.
   */
  async update(
    userId: number,
    projectId: number,
    dto: UpdateUserRoleDto,
    requesterUserId: number,
  ): Promise<UserRoleRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      UserRoleUpdateRow[]
    >('SP_USER_ROLE_UPDATE', [
      userId,
      projectId,
      dto.role_code ?? null,
      dto.status ?? null,
      requesterUserId,
    ]);

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 30003) {
      throw new BusinessException(ResultCode.DISALLOWED_VALUE);
    }
    if (result === 31007) {
      throw new BusinessException(ResultCode.USER_ROLE_NOT_FOUND);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    void this.auditLog.record({
      action: AuditAction.UPDATE,
      companyId: row.company_id,
      projectId: row.project_id,
      tableName: 'user_role',
      targetId: JSON.stringify({
        user_id: row.user_id,
        project_id: row.project_id,
      }),
      targetName: `${row.user_name} (${row.project_name})`,
      beforeJson: row.before_json,
      afterJson: row.after_json,
      createdBy: requesterUserId,
      createdByName: row.requester_name,
    });

    return {
      user_id: row.user_id,
      project_id: row.project_id,
      role_code: row.role_code,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
