import { Injectable } from '@nestjs/common';
import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { BusinessException } from '../common/response/business.exception';
import { ResultCode } from '../common/response/result-code.enum';
import { RoleCode } from '../common/roles/role-code.enum';
import { LogAuditListQueryDto } from './dto/log-audit-list-query.dto';

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
  roleCode: RoleCode;
  companyId: number;
}

/**
 * 13_LOG_AUDIT_API.md 5/6장(목록/상세 조회)의 비즈니스 로직. 로그 DB(coupon_platform_log)가
 * 메인 DB의 user/user_role에 물리적으로 접근할 수 없어(02_DEV_CONVENTIONS.md 1장) SP_LOG_AUDIT_LIST/
 * GET_BY_ID는 호출자 권한을 스스로 재검증하지 못한다 - 이 서비스가 유일한 권한 판단 지점이다
 * (SUPER_ADMIN 전체조회 / DEVELOPER는 본인 소속 company_id로 고정 스코핑, 13_LOG_AUDIT_API.md 3장).
 *
 * @author trisakion
 */
@Injectable()
export class LogAuditService {
  constructor(private readonly logSpExecutor: LogSpExecutorService) {}

  async list(
    query: LogAuditListQueryDto,
    requester: LogAuditRequester,
  ): Promise<PaginatedResult<LogAuditListItem>> {
    const companyId =
      requester.roleCode === RoleCode.SUPER_ADMIN
        ? (query.company_id ?? null)
        : requester.companyId;

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
}
