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
import { resolveDeveloperProjectIds } from '../common/roles/developer-project-ids.util';
import { LogRateLimitListQueryDto } from './dto/log-rate-limit-list-query.dto';

/** SP_LOG_COUPON_RATE_LIMIT_LIST 반환 행 — 요청한 page가 데이터 범위를 벗어나면 idx를 비롯한
 * 모든 데이터 컬럼이 NULL인 채로 total_count만 채워진 행 1개가 온다(LEFT JOIN ... ON TRUE). */
interface LogRateLimitListRow {
  idx: number | null;
  limit_scope: number | null;
  action: number | null;
  api_key: string | null;
  project_id: number | null;
  company_id: number | null;
  game_user_id: string | null;
  retry_after_sec: number | null;
  caller_ip: string | null;
  created_at: string | null;
  total_count: number;
}

export interface LogRateLimitListItem {
  idx: number;
  limit_scope: number;
  action: number;
  api_key: string;
  project_id: number | null;
  company_id: number | null;
  game_user_id: string | null;
  retry_after_sec: number;
  caller_ip: string | null;
  created_at: string;
}

/** 요청자 컨텍스트 — JwtAuthGuard가 검증한 JWT 페이로드 값(DB 재조회 없이 신뢰). */
export interface LogRateLimitRequester {
  userId: number;
  roleCode: RoleCode;
  companyId: number;
}

/**
 * 16_MENU_PERMISSION.md 2.6(레이트리밋 로그 목록 조회)의 비즈니스 로직. `log-audit`와 동일한
 * 물리적 제약(로그 DB가 메인 DB의 user/user_role에 접근 불가, 04_DEV_CONVENTIONS.md 1장) 때문에
 * SP_LOG_COUPON_RATE_LIMIT_LIST는 호출자 권한을 스스로 재검증하지 못한다 - 이 서비스가 유일한
 * 권한 판단 지점이다(SUPER_ADMIN 전체조회 / DEVELOPER는 본인 소속 company_id + 역할보유
 * (role_code<=20) 배정 프로젝트로 스코핑). `log_coupon_rate_limit`의 모든 행이 개념적으로
 * 프로젝트 단위 이벤트라(company/user 테이블처럼 프로젝트와 무관한 행이 없음) `log-audit`의
 * `PROJECT_SCOPED_TABLE_NAMES` 같은 예외 조건 없이 DEVELOPER 호출이면 항상 프로젝트 필터를
 * 적용한다.
 *
 * @author trisakion
 */
@Injectable()
export class LogRateLimitService {
  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly logSpExecutor: LogSpExecutorService,
  ) {}

  async list(
    query: LogRateLimitListQueryDto,
    requester: LogRateLimitRequester,
  ): Promise<PaginatedResult<LogRateLimitListItem>> {
    const companyId =
      requester.roleCode === RoleCode.SUPER_ADMIN
        ? (query.company_id ?? null)
        : requester.companyId;

    const developerProjectIds =
      requester.roleCode === RoleCode.SUPER_ADMIN
        ? null
        : await resolveDeveloperProjectIds(this.spExecutor, requester.userId);

    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.logSpExecutor.callProcedure<
      LogRateLimitListRow[]
    >('SP_LOG_COUPON_RATE_LIMIT_LIST', [
      companyId,
      query.project_id ?? null,
      query.limit_scope ?? null,
      query.action ?? null,
      query.game_user_id ?? null,
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
    const items: LogRateLimitListItem[] = rows
      .filter(
        (row): row is LogRateLimitListRow & { idx: number } => row.idx !== null,
      )
      .map((row) => ({
        idx: row.idx,
        limit_scope: row.limit_scope!,
        action: row.action!,
        api_key: row.api_key!,
        project_id: row.project_id,
        company_id: row.company_id,
        game_user_id: row.game_user_id,
        retry_after_sec: row.retry_after_sec!,
        caller_ip: row.caller_ip,
        created_at: row.created_at!,
      }));

    return buildPaginatedResult(query, totalCount, items);
  }
}
