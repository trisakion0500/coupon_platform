import { Injectable, Logger } from '@nestjs/common';
import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { ResultCode } from '../common/response/result-code.enum';
import { CouponUseLogListQueryDto } from './dto/coupon-use-log-list-query.dto';

/** SP_LOG_COUPON_USE_LIST(로그 DB) 반환 행 — 요청한 page가 데이터 범위를 벗어나면 idx를
 * 비롯한 모든 데이터 컬럼이 NULL인 채로 total_count만 채워진 행 1개가 온다(LEFT JOIN ... ON TRUE). */
interface CouponUseLogRow {
  idx: number | null;
  action: number | null;
  project_id: number | null;
  coupon_campaign_id: number | null;
  code_value: string | null;
  game_user_id: string | null;
  result_type: number | null;
  caller_ip: string | null;
  created_at: string | null;
  total_count: number;
}

export interface CouponUseLogItem {
  idx: number;
  action: number;
  project_id: number;
  coupon_campaign_id: number | null;
  campaign_name: string | null;
  code_value: string;
  game_user_id: string;
  result_type: number;
  caller_ip: string | null;
  created_at: string;
}

/** SP_CAMPAIGN_GET_BY_ID(메인 DB) 반환 행 — campaign_name 보강용으로 name만 필요. */
interface CampaignNameRow {
  name: string;
}

export interface CouponUseLogRequester {
  userId: number;
}

/**
 * 17_CAMPAIGN_API.md 4.3(GET /coupon-use-logs) 비즈니스 로직. log_coupon_use는 로그 DB에
 * 있어 SP_LOG_COUPON_USE_LIST가 호출자 권한을 스스로 재검증하지 못하므로(02_DEV_CONVENTIONS.md
 * 3.2 예외), 이 서비스가 먼저 메인 DB(SP_PROJECT_CHECK_ACCESS)로 project_id 접근권한만
 * 확인하고(통과 못하면 로그 DB는 호출조차 하지 않음), 통과했을 때만 로그 DB를 조회하는 2단계
 * 패턴을 쓴다.
 *
 * @author trisakion
 */
@Injectable()
export class CouponUseLogService {
  private readonly logger = new Logger(CouponUseLogService.name);

  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly logSpExecutor: LogSpExecutorService,
  ) {}

  async list(
    query: CouponUseLogListQueryDto,
    requester: CouponUseLogRequester,
  ): Promise<PaginatedResult<CouponUseLogItem>> {
    if (!query.project_id) {
      throw new BusinessException(ResultCode.REQUIRED_FIELD_MISSING);
    }

    const { result: accessResult } = await this.spExecutor.callProcedure(
      'SP_PROJECT_CHECK_ACCESS',
      [query.project_id, requester.userId],
    );
    if (accessResult === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (accessResult !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.logSpExecutor.callProcedure<
      CouponUseLogRow[]
    >('SP_LOG_COUPON_USE_LIST', [
      query.project_id,
      query.coupon_campaign_id ?? null,
      query.game_user_id ?? null,
      query.code_value ?? null,
      query.action ?? null,
      query.result_type ?? null,
      query.from_created_at ?? null,
      query.to_created_at ?? null,
      query.page_size,
      offset,
    ]);

    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rawRows = data ?? [];
    const totalCount = rawRows[0]?.total_count ?? 0;
    const rows = rawRows.filter(
      (row): row is CouponUseLogRow & { idx: number } => row.idx !== null,
    );

    const campaignNames = await this.resolveCampaignNames(
      rows,
      requester.userId,
    );

    const items: CouponUseLogItem[] = rows.map((row) => ({
      idx: row.idx,
      action: row.action!,
      project_id: row.project_id!,
      coupon_campaign_id: row.coupon_campaign_id,
      campaign_name:
        row.coupon_campaign_id !== null
          ? (campaignNames.get(row.coupon_campaign_id) ?? null)
          : null,
      code_value: row.code_value!,
      game_user_id: row.game_user_id!,
      result_type: row.result_type!,
      caller_ip: row.caller_ip,
      created_at: row.created_at!,
    }));

    return buildPaginatedResult(query, totalCount, items);
  }

  /**
   * campaign_name은 log_coupon_use 자체 컬럼이 아니다 — 로그 DB는 메인 DB와 물리 분리라 SQL
   * JOIN이 불가능해(02_DEV_CONVENTIONS.md 1장), coupon_campaign_id가 있는 행만 메인 DB에서
   * 배치 조회해 붙인다(17_CAMPAIGN_API.md 4.3). 이미 project_id 접근권한이 확인된 뒤라 각
   * 캠페인은 그 프로젝트 범위 안에 있는 게 보장되므로 SP_CAMPAIGN_GET_BY_ID의 스코핑 재검증은
   * 항상 통과한다. 순수 로깅 보강용 조회라 개별 조회가 실패해도(레이스로 그 사이 등) 에러를
   * 전파하지 않고 해당 캠페인만 이름 없이 남긴다(CouponUsageService.resolveCampaignIdForLog와
   * 동일한 soft-fail 패턴).
   */
  private async resolveCampaignNames(
    rows: Array<{ coupon_campaign_id: number | null }>,
    requesterUserId: number,
  ): Promise<Map<number, string>> {
    const ids = [
      ...new Set(
        rows
          .map((row) => row.coupon_campaign_id)
          .filter((id): id is number => id !== null),
      ),
    ];

    const names = new Map<number, string>();
    await Promise.all(
      ids.map(async (id) => {
        try {
          const { result, data } = await this.spExecutor.callProcedure<
            CampaignNameRow[]
          >('SP_CAMPAIGN_GET_BY_ID', [id, requesterUserId]);
          if (result === 0 && data?.[0]) {
            names.set(id, data[0].name);
          }
        } catch (err) {
          this.logger.warn(
            `SP_CAMPAIGN_GET_BY_ID lookup failed while enriching coupon-use-logs: ${(err as Error).message}`,
          );
        }
      }),
    );
    return names;
  }
}
