import { Injectable } from '@nestjs/common';
import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { LogAuditListQueryDto } from './dto/log-audit-list-query.dto';

/** project_id를 갖는 로그 대상 테이블 — DEVELOPER의 배정 프로젝트 스코핑 대상(13_LOG_AUDIT_API.md 3장). */
const PROJECT_SCOPED_TABLE_NAMES = new Set(['project', 'user_role']);

/** SP_LOG_AUDIT_LIST 반환 행 — 요청한 page가 데이터 범위를 벗어나면 idx를 비롯한 모든 데이터
 * 컬럼이 NULL인 채로 total_count만 채워진 행 1개가 온다(LEFT JOIN ... ON TRUE). */
interface LogAuditListRow {
  idx: number | null;
  company_id: number | null;
  project_id: number | null;
  table_name: string | null;
  target_id: string | null;
  target_name: string | null;
  action: number | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string | null;
  total_count: number;
}

export interface LogAuditListItem {
  idx: number;
  company_id: number | null;
  project_id: number | null;
  table_name: string;
  target_id: string;
  target_name: string | null;
  action: number;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
}

/** SP_LOG_AUDIT_GET_BY_ID 반환 행 — before_json/after_json은 log_audit 컬럼이 LONGTEXT라
 * mysql2가 자동 파싱하지 않는다(메인 DB의 JSON 타입 컬럼과 다름) - 서비스가 직접 JSON.parse한다. */
interface LogAuditDetailRow {
  idx: number;
  company_id: number | null;
  project_id: number | null;
  table_name: string;
  target_id: string;
  target_name: string | null;
  action: number;
  before_json: string | null;
  after_json: string;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
}

export interface LogAuditDetail {
  idx: number;
  company_id: number | null;
  project_id: number | null;
  table_name: string;
  target_id: string;
  target_name: string | null;
  action: number;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown>;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
}

/** 요청자 컨텍스트 — JwtAuthGuard가 검증한 JWT 페이로드 값(DB 재조회 없이 신뢰). */
export interface LogAuditRequester {
  userId: number;
  roleCode: RoleCode;
  companyId: number;
}

/**
 * 13_LOG_AUDIT_API.md 5/6장(목록/상세 조회)의 비즈니스 로직. 로그 DB(coupon_platform_log)가
 * 메인 DB의 user/user_role에 물리적으로 접근할 수 없어(02_DEV_CONVENTIONS.md 1장) SP_LOG_AUDIT_LIST/
 * GET_BY_ID는 호출자 권한을 스스로 재검증하지 못한다 - 이 서비스가 유일한 권한 판단 지점이다
 * (SUPER_ADMIN 전체조회 / DEVELOPER는 본인 소속 company_id로 고정 스코핑, 13_LOG_AUDIT_API.md 3장).
 * DEVELOPER의 project/user_role 테이블 로그는 여기서 한 단계 더 좁힌다 - 프로젝트 관리메뉴 스코핑을
 * 회사 단위에서 배정 프로젝트 단위(role_code<=20)로 좁힌 것(2026-07-24)과 같은 방향으로, 메인 DB
 * (SpExecutorService)에서 배정 프로젝트 목록을 먼저 조회해 로그 DB SP의 필터 파라미터로 전달하는
 * 2단계 패턴을 쓴다(02_DEV_CONVENTIONS.md 3.2). company/user 테이블 로그는 프로젝트 단위 정보가
 * 없거나 간접적이라 대상에서 제외하고 기존처럼 company_id로만 스코핑한다.
 *
 * @author trisakion
 */
@Injectable()
export class LogAuditService {
  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly logSpExecutor: LogSpExecutorService,
  ) {}

  async list(
    query: LogAuditListQueryDto,
    requester: LogAuditRequester,
  ): Promise<PaginatedResult<LogAuditListItem>> {
    const companyId =
      requester.roleCode === RoleCode.SUPER_ADMIN
        ? (query.company_id ?? null)
        : requester.companyId;

    const developerProjectIds =
      requester.roleCode === RoleCode.SUPER_ADMIN
        ? null
        : await this.resolveDeveloperProjectIds(requester.userId);

    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.logSpExecutor.callProcedure<
      LogAuditListRow[]
    >('SP_LOG_AUDIT_LIST', [
      companyId,
      query.project_id ?? null,
      query.table_name ?? null,
      query.target_id ?? null,
      query.action ?? null,
      query.from_created_at ?? null,
      query.to_created_at ?? null,
      query.page_size,
      offset,
      developerProjectIds,
    ]);

    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const totalCount = rows[0]?.total_count ?? 0;
    const items: LogAuditListItem[] = rows
      .filter(
        (row): row is LogAuditListRow & { idx: number } => row.idx !== null,
      )
      .map((row) => ({
        idx: row.idx,
        company_id: row.company_id,
        project_id: row.project_id,
        table_name: row.table_name!,
        target_id: row.target_id!,
        target_name: row.target_name,
        action: row.action!,
        created_by: row.created_by!,
        created_by_name: row.created_by_name,
        created_at: row.created_at!,
      }));

    return buildPaginatedResult(query, totalCount, items);
  }

  async getById(
    idx: number,
    requester: LogAuditRequester,
  ): Promise<LogAuditDetail> {
    const { result, data } = await this.logSpExecutor.callProcedure<
      LogAuditDetailRow[]
    >('SP_LOG_AUDIT_GET_BY_ID', [idx]);

    if (result === 31008) {
      throw new BusinessException(ResultCode.LOG_AUDIT_NOT_FOUND);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    // SP가 로그 DB의 물리적 제약으로 권한을 재검증하지 못하므로, 여기가 유일한 방어선이다
    // (ProjectService.getById의 "방어적 이중 체크"와 달리 이중이 아니라 단일 방어선).
    if (
      requester.roleCode !== RoleCode.SUPER_ADMIN &&
      row.company_id !== requester.companyId
    ) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }

    // DEVELOPER의 project/user_role 로그는 회사 소속만으로 부족하다 - 실제 배정 프로젝트인지
    // 추가로 확인한다(list()의 i_developer_project_ids와 동일한 스코핑 규칙).
    if (
      requester.roleCode !== RoleCode.SUPER_ADMIN &&
      PROJECT_SCOPED_TABLE_NAMES.has(row.table_name)
    ) {
      const developerProjectIds = await this.resolveDeveloperProjectIds(
        requester.userId,
      );
      const allowedIds = new Set(
        developerProjectIds ? developerProjectIds.split(',') : [],
      );
      if (row.project_id === null || !allowedIds.has(String(row.project_id))) {
        throw new BusinessException(ResultCode.PERMISSION_DENIED);
      }
    }

    return {
      idx: row.idx,
      company_id: row.company_id,
      project_id: row.project_id,
      table_name: row.table_name,
      target_id: row.target_id,
      target_name: row.target_name,
      action: row.action,
      before_json:
        row.before_json === null
          ? null
          : (JSON.parse(row.before_json) as Record<string, unknown>),
      after_json: JSON.parse(row.after_json) as Record<string, unknown>,
      created_by: row.created_by,
      created_by_name: row.created_by_name,
      created_at: row.created_at,
    };
  }

  /**
   * SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS(메인 DB)로 호출자가 role_code<=20(DEVELOPER 이상)
   * 으로 배정된 프로젝트 ID 콤마 문자열을 조회한다. 배정이 하나도 없으면 GROUP_CONCAT이 NULL을
   * 반환하므로 빈 문자열로 정규화한다 - "제한 없음"(SUPER_ADMIN이 list()에서 넘기는 실제 NULL)과
   * 혼동되지 않도록 호출부가 항상 빈 문자열/콤마 목록 둘 중 하나만 받게 한다.
   */
  private async resolveDeveloperProjectIds(userId: number): Promise<string> {
    const { result, data } = await this.spExecutor.callProcedure<
      Array<{ project_ids: string | null }>
    >('SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS', [userId]);

    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return data?.[0]?.project_ids ?? '';
  }
}
