import { Injectable, Logger } from '@nestjs/common';
import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import { PaginatedResult } from '../common/response/pagination';
import { ResultCode } from '../common/response/result-code.enum';
import { UnconfirmedQueryDto } from './dto/unconfirmed-query.dto';

/** log_coupon_use.action (18_COUPON_USAGE_API.md 1.5). */
enum UsageLogAction {
  RESERVE = 10,
  CONFIRM = 20,
}

/**
 * SP_COUPON_RESERVE 성공 시 반환 행 — 18_COUPON_USAGE_API.md 2.1 Response 그대로.
 * `reserve()`의 반환 타입으로 그대로 노출된다(컨트롤러가 이 이름을 참조할 수 있어야 하므로
 * export가 필요 - 별도 타입 별칭을 두면 구조적 타이핑 때문에 오히려 원본 인터페이스 이름을
 * 참조하게 되어 TS4053이 난다).
 */
export interface ReserveResult {
  coupon_code_usage_id: number;
  coupon_campaign_id: number;
  code_value: string;
  game_user_id: string;
  reward_data: Record<string, unknown>;
  created_at: string;
}

/** SP_COUPON_CONFIRM 성공 시 반환 행 — coupon_campaign_id는 로그 기록 전용(공개 응답에는 없음). */
interface ConfirmRow {
  coupon_code_usage_id: number;
  coupon_campaign_id: number;
  confirmed_at: string;
}

/** POST /v1/coupons/{code}/confirm 응답(18_COUPON_USAGE_API.md 2.2) — coupon_campaign_id 제외. */
export interface ConfirmResult {
  coupon_code_usage_id: number;
  confirmed_at: string;
}

/** SP_COUPON_CODE_GET_BY_VALUE 반환 행 — 실패 로그의 coupon_campaign_id 보강 전용. */
interface CodeLookupRow {
  coupon_code_id: number;
  coupon_campaign_id: number;
  status: number;
}

/** SP_COUPON_UNCONFIRMED_LIST 반환 행 — 두 모드(특정유저/전체유저) 공통. */
interface UnconfirmedRow {
  code_value: string | null;
  game_user_id: string;
  coupon_campaign_id: number | null;
  reward_data: Record<string, unknown>;
  created_at: string;
  total_count: number;
}

export interface UnconfirmedItem {
  code_value: string;
  game_user_id: string;
  coupon_campaign_id: number;
  reward_data: Record<string, unknown>;
  created_at: string;
}

/** GET /v1/coupons/unconfirmed 응답 — 특정유저 모드는 items만, 전체유저 모드는 페이지네이션 포함. */
export type UnconfirmedResult = { items: UnconfirmedItem[] } | PaginatedResult<UnconfirmedItem>;

/** RESERVE 실패 result 코드 -> log_coupon_use.result_type(18_COUPON_USAGE_API.md 4장). */
const RESERVE_LOG_TYPE_MAP: Record<number, number> = {
  [ResultCode.COUPON_CODE_NOT_FOUND]: 10,
  [ResultCode.COUPON_CODE_ALREADY_USED_OR_STOPPED]: 20,
  [ResultCode.CAMPAIGN_NOT_USABLE]: 30,
  [ResultCode.USER_USE_LIMIT_EXCEEDED]: 40,
};

/** CONFIRM 실패 result 코드 -> log_coupon_use.result_type(18_COUPON_USAGE_API.md 4장). */
const CONFIRM_LOG_TYPE_MAP: Record<number, number> = {
  [ResultCode.COUPON_CODE_NOT_FOUND]: 10,
  [ResultCode.USAGE_NOT_FOUND]: 50,
};

/**
 * 18_COUPON_USAGE_API.md 2장(Reserve/Confirm) + 3장(미컨슘 조회) 3개 엔드포인트의 비즈니스
 * 로직. 게임서버가 S2S(API Key+HMAC)로 호출하는 도메인이라 `user_role` 권한 체계와 무관하고,
 * `project_id`는 `S2sAuthGuard`가 인증한 값을 컨트롤러가 그대로 전달한다(06_COUPON_USAGE_SCENARIO.md
 * 1.3 - 코드 조회 자체가 `WHERE project_id=? AND code_value=?`로 스코핑되어 다른 프로젝트
 * 소속 코드는 존재하지 않는 것과 동일하게 처리됨).
 *
 * @author trisakion
 */
@Injectable()
export class CouponUsageService {
  private readonly logger = new Logger(CouponUsageService.name);

  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly logSpExecutor: LogSpExecutorService,
  ) {}

  /**
   * 쿠폰 코드 예약(=즉시 소모 확정, 18_COUPON_USAGE_API.md 2.1). 성공/실패 여부와 무관하게
   * 매 호출마다 log_coupon_use에 기록한다(1.5) - 실패 시 코드가 존재했던 경우(33001/33002/
   * 33003)는 {@link resolveCampaignIdForLog}로 campaign_id를 보강한다.
   */
  async reserve(
    projectId: number,
    codeValue: string,
    gameUserId: string,
  ): Promise<ReserveResult> {
    const { result, data } = await this.spExecutor.callProcedure<ReserveResult[]>(
      'SP_COUPON_RESERVE',
      [projectId, codeValue, gameUserId],
    );

    if (result === 0 && data?.[0]) {
      const row = data[0];
      void this.logAttempt(
        UsageLogAction.RESERVE,
        projectId,
        row.coupon_campaign_id,
        codeValue,
        gameUserId,
        0,
      );
      return row;
    }

    const campaignId = await this.resolveCampaignIdForLog(
      result,
      projectId,
      codeValue,
    );
    void this.logAttempt(
      UsageLogAction.RESERVE,
      projectId,
      campaignId,
      codeValue,
      gameUserId,
      RESERVE_LOG_TYPE_MAP[result] ?? 0,
    );

    if (result === ResultCode.COUPON_CODE_NOT_FOUND) {
      throw new BusinessException(ResultCode.COUPON_CODE_NOT_FOUND);
    }
    if (result === ResultCode.COUPON_CODE_ALREADY_USED_OR_STOPPED) {
      throw new BusinessException(ResultCode.COUPON_CODE_ALREADY_USED_OR_STOPPED);
    }
    if (result === ResultCode.CAMPAIGN_NOT_USABLE) {
      throw new BusinessException(ResultCode.CAMPAIGN_NOT_USABLE);
    }
    if (result === ResultCode.USER_USE_LIMIT_EXCEEDED) {
      throw new BusinessException(ResultCode.USER_USE_LIMIT_EXCEEDED);
    }
    throw new BusinessException(ResultCode.INTERNAL_ERROR);
  }

  /**
   * 쿠폰 사용 지급결과 기록(18_COUPON_USAGE_API.md 2.2) - reserve와 동일하게 성공/실패 무관
   * 매 호출마다 log_coupon_use에 기록한다. 컨트롤러/클라이언트에는 공개 응답 필드
   * (coupon_code_usage_id/confirmed_at)만 명시적으로 재구성해 반환한다 - SP가 로깅용으로
   * 함께 내려주는 coupon_campaign_id는 여기서 걸러진다(13_LOG_AUDIT_API.md 구현 때 확립한
   * "응답 객체는 항상 명시적으로 재구성" 원칙과 동일).
   */
  async confirm(
    projectId: number,
    codeValue: string,
    gameUserId: string,
  ): Promise<ConfirmResult> {
    const { result, data } = await this.spExecutor.callProcedure<ConfirmRow[]>(
      'SP_COUPON_CONFIRM',
      [projectId, codeValue, gameUserId],
    );

    if (result === 0 && data?.[0]) {
      const row = data[0];
      void this.logAttempt(
        UsageLogAction.CONFIRM,
        projectId,
        row.coupon_campaign_id,
        codeValue,
        gameUserId,
        0,
      );
      return {
        coupon_code_usage_id: row.coupon_code_usage_id,
        confirmed_at: row.confirmed_at,
      };
    }

    const campaignId = await this.resolveCampaignIdForLog(
      result,
      projectId,
      codeValue,
    );
    void this.logAttempt(
      UsageLogAction.CONFIRM,
      projectId,
      campaignId,
      codeValue,
      gameUserId,
      CONFIRM_LOG_TYPE_MAP[result] ?? 0,
    );

    if (result === ResultCode.COUPON_CODE_NOT_FOUND) {
      throw new BusinessException(ResultCode.COUPON_CODE_NOT_FOUND);
    }
    if (result === ResultCode.USAGE_NOT_FOUND) {
      throw new BusinessException(ResultCode.USAGE_NOT_FOUND);
    }
    throw new BusinessException(ResultCode.INTERNAL_ERROR);
  }

  /**
   * 미컨슘 쿠폰 사용 조회(18_COUPON_USAGE_API.md 3장) - `game_user_id` 지정 여부로 특정유저
   * (페이지네이션 미적용, 전체 반환)/전체유저(페이지네이션 필수) 모드가 갈린다. `game_user_id`
   * 미지정 상태에서 page/page_size 누락은 정확히 30001로 응답해야 해서(Errors 표) DTO의
   * `@ValidateIf` 대신 여기서 직접 검증한다(UnconfirmedQueryDto 클래스 주석 참고). 이 API는
   * 조회 전용이라 log_coupon_use 기록 대상이 아니다(action 컬럼이 10/20만 정의).
   */
  async listUnconfirmed(
    projectId: number,
    query: UnconfirmedQueryDto,
  ): Promise<UnconfirmedResult> {
    const isSpecificUserMode = query.game_user_id !== undefined;

    if (!isSpecificUserMode && (query.page === undefined || query.page_size === undefined)) {
      throw new BusinessException(ResultCode.REQUIRED_FIELD_MISSING);
    }

    const pageSize = isSpecificUserMode ? null : query.page_size!;
    const offset = isSpecificUserMode ? null : (query.page! - 1) * query.page_size!;

    const { result, data } = await this.spExecutor.callProcedure<
      UnconfirmedRow[]
    >('SP_COUPON_UNCONFIRMED_LIST', [
      projectId,
      query.game_user_id ?? null,
      query.campaign_id ?? null,
      pageSize,
      offset,
    ]);

    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const items: UnconfirmedItem[] = rows
      .filter(
        (row): row is UnconfirmedRow & { coupon_campaign_id: number } =>
          row.coupon_campaign_id !== null,
      )
      .map((row) => ({
        code_value: row.code_value!,
        game_user_id: row.game_user_id,
        coupon_campaign_id: row.coupon_campaign_id,
        reward_data: row.reward_data,
        created_at: row.created_at,
      }));

    if (isSpecificUserMode) {
      return { items };
    }

    return {
      page: query.page!,
      page_size: query.page_size!,
      total_count: rows[0]?.total_count ?? 0,
      items,
    };
  }

  /**
   * SP_COUPON_RESERVE/CONFIRM은 실패 시 RESULT 단일 컬럼만 반환하므로(02_DEV_CONVENTIONS.md
   * 3.4), 코드가 존재했던 실패(RESERVE의 33001/33002/33003, CONFIRM의 31006)의 로그에
   * coupon_campaign_id를 채우려면 별도 조회가 필요하다(SP_COUPON_CODE_GET_BY_VALUE.sql 헤더
   * 주석 참고). 코드없음(31005)이면 조회할 필요가 없어 곧장 NULL을 반환한다. 순수 로깅 보강용
   * 조회라 실패해도(레이스로 그 사이 코드가 사라지는 등) 에러를 전파하지 않고 NULL로 남긴다.
   */
  private async resolveCampaignIdForLog(
    resultCode: number,
    projectId: number,
    codeValue: string,
  ): Promise<number | null> {
    if (resultCode === 0 || resultCode === ResultCode.COUPON_CODE_NOT_FOUND) {
      return null;
    }

    try {
      const { result, data } = await this.spExecutor.callProcedure<
        CodeLookupRow[]
      >('SP_COUPON_CODE_GET_BY_VALUE', [projectId, codeValue]);

      return result === 0 && data?.[0] ? data[0].coupon_campaign_id : null;
    } catch (err) {
      this.logger.warn(
        `SP_COUPON_CODE_GET_BY_VALUE lookup failed while enriching log_coupon_use: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** log_coupon_use 적재(로그 DB) - 실패해도 메인 흐름에 영향 없는 fire-and-forget. */
  private async logAttempt(
    action: UsageLogAction,
    projectId: number,
    campaignId: number | null,
    codeValue: string,
    gameUserId: string,
    resultType: number,
  ): Promise<void> {
    await this.logSpExecutor.logCall('SP_LOG_COUPON_USE_CREATE', [
      action,
      projectId,
      campaignId,
      codeValue,
      gameUserId,
      resultType,
    ]);
  }
}
