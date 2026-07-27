import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { customAlphabet } from 'nanoid';
import { computeCodeGenerationStaleThresholdSec } from '../common/config/code-generation-stale-threshold.util';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { ResultCode } from '../common/response/result-code.enum';
import { CampaignRequester } from './campaign.service';
import { CodeListQueryDto } from './dto/code-list-query.dto';
import { IssueCodesDto } from './dto/issue-codes.dto';

/**
 * RANDOM 코드값 생성 규칙(06_DATABASE_SCHEMA.md 6장) —
 * 혼동하기 쉬운 문자(0/1/I/O)를 뺀 32자 알파벳으로 12자리를 뽑고, use_hyphen이면
 * 4자리씩 하이픈으로 묶는다(`XXXX-XXXX-XXXX`).
 */
const generateRandomCode = customAlphabet(
  '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
  12,
);

/**
 * `SP_CAMPAIGN_CODE_GENERATE_ONE`이 SQLEXCEPTION으로 실패했을 때(RESULT=50001) 재시도할
 * 가치가 있다고 보는 MySQL 에러번호 — `07_COUPON_ISSUANCE_SCENARIO.md` 2.2가 예로 든
 * "deadlock, lock wait timeout"에 정확히 대응한다(ER_LOCK_DEADLOCK/ER_LOCK_WAIT_TIMEOUT).
 * 이 집합에 없는 에러(예: 제약 위반류)는 몇 번을 재시도해도 결과가 달라지지 않으므로 즉시
 * 실패 처리한다(`isRetryableGenerationError` 참고).
 */
const RETRYABLE_MYSQL_ERROR_NOS = new Set([1205, 1213]);

/** SP_CAMPAIGN_CODE_ISSUE 반환 행 — RANDOM/FIXED 응답 조립 + 백그라운드 루프 재개용 필드 슈퍼셋. */
interface CodeIssueRow {
  coupon_campaign_id: number;
  project_id: number;
  code_type: number;
  use_hyphen: number;
  requested_qty: number;
  generated_qty: number;
  generation_status: number;
  coupon_code_id: number | null;
  code_value: string | null;
  code_status: number | null;
}

/** SP_CAMPAIGN_CODE_RETRY 반환 행 — 백그라운드 루프 재개에 필요한 필드만. */
interface CodeRetryRow {
  coupon_campaign_id: number;
  project_id: number;
  use_hyphen: number;
  requested_qty: number;
  generated_qty: number;
  generation_status: number;
}

/** POST /campaigns/{id}/codes 응답(19_CAMPAIGN_API.md 3.1) — FIXED만 generated_qty/coupon_code를 포함한다. */
export interface IssueCodesResult {
  coupon_campaign_id: number;
  generation_status: number;
  generated_qty?: number;
  coupon_code?: {
    coupon_code_id: number;
    code_value: string;
    status: number;
  };
}

/** POST /campaigns/{id}/codes/retry 응답(19_CAMPAIGN_API.md 3.2). */
export interface RetryCodesResult {
  coupon_campaign_id: number;
  generation_status: number;
}

/** SP_CAMPAIGN_CODE_LIST 반환 행 — 목록용 컬럼 + total_count. */
interface CodeListRow {
  coupon_code_id: number | null;
  code_value: string;
  status: number;
  created_at: string;
  total_count: number;
}

export interface CodeListItem {
  coupon_code_id: number;
  code_value: string;
  status: number;
  created_at: string;
}

/** 백그라운드 대량생성 루프가 필요로 하는 최소 정보(SP_CAMPAIGN_CODE_ISSUE/RETRY 공통). */
interface RandomGenerationJob {
  coupon_campaign_id: number;
  project_id: number;
  use_hyphen: number;
  requested_qty: number;
  generated_qty: number;
}

/**
 * SP_CAMPAIGN_CODE_GENERATE_ONE 반환 행 — generation_status/status로 job이 아직 살아있는지
 * 확인한다(generation_status<>2면 abort 등으로 job을 빼앗김, status=4면 캠페인 자체가
 * 종료됨 — 07_COUPON_ISSUANCE_SCENARIO.md 2.4 참고, 둘은 별개 축이라 함께 확인해야 한다).
 */
interface CodeGenerateOneRow {
  generated_qty: number;
  generation_status: number;
  status: number;
}

/** SP_CAMPAIGN_CODE_ABORT 반환 행. */
interface CodeAbortRow {
  coupon_campaign_id: number;
  generation_status: number;
}

/** POST /campaigns/{id}/codes/abort 응답(19_CAMPAIGN_API.md 3.4). */
export interface AbortCodeGenerationResult {
  coupon_campaign_id: number;
  generation_status: number;
}

/**
 * 19_CAMPAIGN_API.md 3장(Coupon Code Issuance) 4개 엔드포인트의 비즈니스 로직 — RANDOM 비동기
 * 대량생성/재시도, FIXED 동기 등록, 진행중 정체 시 수동 복구(abort), 코드 목록 조회.
 * CampaignService(2장 CRUD+승인워크플로우)와 분리된 이유는 2026-07-24 리팩터링 참고
 * (`campaign.service.ts`가 코드발급 로직까지 포함해 1100줄을 넘겨 비대해졌었음). 스코핑 재검증
 * 원칙(requesterUserId만 전달, role_code는 SP가 재확인)은 CampaignService와 동일하다.
 *
 * @author trisakion
 */
@Injectable()
export class CampaignCodeService {
  private readonly logger = new Logger(CampaignCodeService.name);
  /** RANDOM 코드 생성 중 DB 일시 오류가 나면 재시도할 최대 횟수(07_COUPON_ISSUANCE_SCENARIO.md 2.2). */
  private readonly maxGenerationDbRetries: number;
  /** exponential backoff 기준 지연(ms) — 시도마다 2배씩 늘어난다. */
  private readonly generationRetryBaseDelayMs: number;
  /** abort 임계값(초) 계산용 안전 배율(07_COUPON_ISSUANCE_SCENARIO.md 2.4). */
  private readonly abortStaleSafetyMultiplier: number;

  constructor(
    private readonly spExecutor: SpExecutorService,
    configService: ConfigService,
  ) {
    this.maxGenerationDbRetries = configService.getOrThrow<number>(
      'CODE_GENERATION_MAX_DB_RETRIES',
    );
    this.generationRetryBaseDelayMs = configService.getOrThrow<number>(
      'CODE_GENERATION_RETRY_BASE_DELAY_MS',
    );
    this.abortStaleSafetyMultiplier = configService.getOrThrow<number>(
      'CODE_GENERATION_ABORT_STALE_SAFETY_MULTIPLIER',
    );
  }

  /**
   * 코드 발급 요청(19_CAMPAIGN_API.md 3.1). SP가 generation_status 1->2 선점까지 원자적으로
   * 끝내고 code_type을 함께 반환하므로, 여기서는 그 값으로 RANDOM/FIXED 응답을 조립하기만 한다.
   * RANDOM은 대량생성을 백그라운드로 돌리고(fire-and-forget, `void`) 즉시 반환한다 — 컨트롤러가
   * 이 반환값에 `coupon_code`가 없는 것을 보고 202로 응답한다. edit_count는 이 SP의 대상이
   * 아니다(coupon_campaign.sql edit_count 헤더 주석 참고).
   */
  async issueCodes(
    campaignId: number,
    dto: IssueCodesDto,
    requesterUserId: number,
  ): Promise<IssueCodesResult> {
    const { result, data } = await this.spExecutor.callProcedure<
      CodeIssueRow[]
    >('SP_CAMPAIGN_CODE_ISSUE', [
      campaignId,
      dto.code_value ?? null,
      requesterUserId,
    ]);

    if (result === 31004) {
      throw new BusinessException(ResultCode.CAMPAIGN_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 30001) {
      throw new BusinessException(ResultCode.REQUIRED_FIELD_MISSING);
    }
    if (result === 30004) {
      throw new BusinessException(ResultCode.INVALID_STATE_TRANSITION);
    }
    if (result === 32001) {
      throw new BusinessException(ResultCode.DUPLICATE_DATA);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];

    if (row.code_type === 2) {
      return {
        coupon_campaign_id: row.coupon_campaign_id,
        generation_status: row.generation_status,
        generated_qty: row.generated_qty,
        coupon_code: {
          coupon_code_id: row.coupon_code_id!,
          code_value: row.code_value!,
          status: row.code_status!,
        },
      };
    }

    void this.generateRandomCodes({
      coupon_campaign_id: row.coupon_campaign_id,
      project_id: row.project_id,
      use_hyphen: row.use_hyphen,
      requested_qty: row.requested_qty,
      generated_qty: row.generated_qty,
    });

    return {
      coupon_campaign_id: row.coupon_campaign_id,
      generation_status: row.generation_status,
    };
  }

  /**
   * 코드 생성 재시도(19_CAMPAIGN_API.md 3.2) — generation_status=4(실패)에서만 허용된다. 이미
   * 생성된 generated_qty는 그대로 두고 남은 수량만 백그라운드 루프로 이어서 생성한다.
   */
  async retryCodeIssuance(
    campaignId: number,
    requesterUserId: number,
  ): Promise<RetryCodesResult> {
    const { result, data } = await this.spExecutor.callProcedure<
      CodeRetryRow[]
    >('SP_CAMPAIGN_CODE_RETRY', [campaignId, requesterUserId]);

    if (result === 31004) {
      throw new BusinessException(ResultCode.CAMPAIGN_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 30004) {
      throw new BusinessException(ResultCode.INVALID_STATE_TRANSITION);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    void this.generateRandomCodes({
      coupon_campaign_id: row.coupon_campaign_id,
      project_id: row.project_id,
      use_hyphen: row.use_hyphen,
      requested_qty: row.requested_qty,
      generated_qty: row.generated_qty,
    });

    return {
      coupon_campaign_id: row.coupon_campaign_id,
      generation_status: row.generation_status,
    };
  }

  /**
   * 진행중(generation_status=2) 정체 캠페인 수동 복구(19_CAMPAIGN_API.md 3.4,
   * 07_COUPON_ISSUANCE_SCENARIO.md 2.4) — 서버 프로세스 재시작 등으로 백그라운드 루프가
   * 유실돼 ISSUE(1 필요)/RETRY(4 필요) 어느 쪽으로도 손댈 수 없게 된 캠페인을 관리자가 강제로
   * 풀 수 있게 한다. `computeAbortStaleThresholdSec`로 계산한 임계값을 SP에 넘겨, 실제로
   * 최근에 진행된 흔적이 있으면(=아직 살아있을 가능성이 높으면) SP가 스스로 거부한다 — 호출자의
   * 판단을 그대로 믿지 않는다.
   */
  async abortCodeGeneration(
    campaignId: number,
    requesterUserId: number,
  ): Promise<AbortCodeGenerationResult> {
    const { result, data } = await this.spExecutor.callProcedure<
      CodeAbortRow[]
    >('SP_CAMPAIGN_CODE_ABORT', [
      campaignId,
      this.computeAbortStaleThresholdSec(),
      requesterUserId,
    ]);

    if (result === 31004) {
      throw new BusinessException(ResultCode.CAMPAIGN_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 30004) {
      throw new BusinessException(ResultCode.INVALID_STATE_TRANSITION);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    return {
      coupon_campaign_id: row.coupon_campaign_id,
      generation_status: row.generation_status,
    };
  }

  /** 캠페인별 쿠폰 코드 목록 조회(19_CAMPAIGN_API.md 3.3) — 조회 전용, 승인상태와 무관. */
  async listCodes(
    campaignId: number,
    query: CodeListQueryDto,
    requester: CampaignRequester,
  ): Promise<PaginatedResult<CodeListItem>> {
    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.spExecutor.callProcedure<CodeListRow[]>(
      'SP_CAMPAIGN_CODE_LIST',
      [
        campaignId,
        query.status ?? null,
        query.page_size,
        offset,
        requester.userId,
      ],
    );

    if (result === 31004) {
      throw new BusinessException(ResultCode.CAMPAIGN_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const totalCount = rows[0]?.total_count ?? 0;
    const items: CodeListItem[] = rows
      .filter(
        (row): row is CodeListRow & { coupon_code_id: number } =>
          row.coupon_code_id !== null,
      )
      .map((row) => ({
        coupon_code_id: row.coupon_code_id,
        code_value: row.code_value,
        status: row.status,
        created_at: row.created_at,
      }));

    return buildPaginatedResult(query, totalCount, items);
  }

  /**
   * RANDOM 코드 대량생성 백그라운드 루프(07_COUPON_ISSUANCE_SCENARIO.md 2.1~2.2) — issueCodes/
   * retryCodeIssuance가 `void`로 fire-and-forget 호출한다. HTTP 응답과 완전히 분리되어 있으므로
   * 이 메서드가 던지는 예외는 아무도 받지 않는다 — 그래서 모든 실패 경로를 내부에서 직접
   * 처리하고 밖으로 던지지 않는다.
   *
   * - 코드값 충돌(32001): backoff 없이 즉시 새 값으로 재시도(단순 재추첨이라 외부 자원 경합이
   *   아님)
   * - SP 계약 위반(RESULT가 0/32001 어느 쪽도 아님): 재시도해도 절대 나아지지 않는 로직 버그이므로
   *   재시도 예산을 쓰지 않고 즉시 실패 처리
   * - DB 일시 오류(SP_CAMPAIGN_CODE_GENERATE_ONE이 50001로 throw): `isRetryableGenerationError`로
   *   실제 재시도할 가치가 있는 에러인지 먼저 가려낸 뒤(07_COUPON_ISSUANCE_SCENARIO.md 2.2 —
   *   "재시도 가능 에러만 대상, 4xx류 등은 즉시 실패 처리"), 재시도 가능하면 exponential
   *   backoff+jitter로 최대 MAX_GENERATION_DB_RETRIES회 재시도, 그 외엔 즉시 실패 처리. 소진/즉시
   *   실패 모두 SP_CAMPAIGN_CODE_GENERATION_FAIL 호출로 이어진다
   * - job을 빼앗김(SP가 돌려준 generation_status가 더 이상 2가 아님 — 예: 관리자가
   *   POST /codes/abort로 이 job을 강제 종료시킴) 또는 캠페인 자체가 종료됨(status=4 —
   *   generation_status와 별개 축이라 따로 확인): 누군가 이미 최종 상태를 결정했다는 뜻이므로
   *   COMPLETE/FAIL을 또 호출하지 않고 조용히 루프만 종료한다(07_COUPON_ISSUANCE_SCENARIO.md 2.4)
   * - 목표 수량 도달: SP_CAMPAIGN_CODE_GENERATION_COMPLETE 호출
   */
  private async generateRandomCodes(job: RandomGenerationJob): Promise<void> {
    let generatedQty = job.generated_qty;
    let dbErrorRetries = 0;

    while (generatedQty < job.requested_qty) {
      const codeValue = this.buildCodeValue(job.use_hyphen);

      try {
        const { result, data } = await this.spExecutor.callProcedure<
          CodeGenerateOneRow[]
        >('SP_CAMPAIGN_CODE_GENERATE_ONE', [
          job.coupon_campaign_id,
          job.project_id,
          codeValue,
        ]);

        if (result === 32001) {
          continue;
        }
        if (result !== 0 || !data?.[0]) {
          const message = `SP_CAMPAIGN_CODE_GENERATE_ONE returned unexpected RESULT=${result}`;
          this.logger.error(`campaign ${job.coupon_campaign_id}: ${message}`);
          await this.finalizeGenerationFailure(job.coupon_campaign_id, message);
          return;
        }

        generatedQty = data[0].generated_qty;

        if (data[0].generation_status !== 2 || data[0].status === 4) {
          // 좀비 루프 방지(수정2/3, SP_CAMPAIGN_CODE_GENERATE_ONE.sql 참고) - 목표 수량에
          // 도달하지 못했더라도 이 job이 더 이상 진행중이 아니면(generation_status<>2, 예:
          // abort로 4/1 전환) 또는 캠페인 자체가 종료됐으면(status=4 — generation_status와
          // 별개 축이라 따로 확인해야 함) 누군가 이미 최종 상태를 정한 것이므로 여기서 조용히
          // 멈춘다. 계속 돌면 SP의 슬롯 예약이 매번 실패해 지연 없이 무한 재시도하게 된다.
          this.logger.warn(
            `campaign ${job.coupon_campaign_id} generation job no longer active (generation_status=${data[0].generation_status}, status=${data[0].status}) - stopping background loop`,
          );
          return;
        }

        dbErrorRetries = 0;
      } catch (err) {
        const message = (err as Error).message.slice(0, 500);

        if (!this.isRetryableGenerationError(err)) {
          this.logger.error(
            `campaign ${job.coupon_campaign_id} code generation failed with a non-retryable error: ${message}`,
          );
          await this.finalizeGenerationFailure(job.coupon_campaign_id, message);
          return;
        }

        dbErrorRetries += 1;
        if (dbErrorRetries > this.maxGenerationDbRetries) {
          this.logger.error(
            `campaign ${job.coupon_campaign_id} code generation exhausted retries: ${message}`,
          );
          await this.finalizeGenerationFailure(job.coupon_campaign_id, message);
          return;
        }
        await this.delay(this.backoffDelayMs(dbErrorRetries));
      }
    }

    try {
      await this.spExecutor.callProcedure(
        'SP_CAMPAIGN_CODE_GENERATION_COMPLETE',
        [job.coupon_campaign_id],
      );
    } catch (err) {
      this.logger.error(
        `SP_CAMPAIGN_CODE_GENERATION_COMPLETE failed for campaign ${job.coupon_campaign_id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * SP 내부 SQLEXCEPTION 중 재시도할 가치가 있는 것만 가려낸다(07_COUPON_ISSUANCE_SCENARIO.md
   * 2.2 — "재시도 가능 에러만 대상, 4xx류 등은 즉시 실패 처리"). `SpExecutorService`는 SP가
   * SQLEXCEPTION을 만나면 SQL_STATE/ERROR_NO를 실은 `BusinessException(DATABASE_ERROR)`을
   * 던지므로(`sp-result.util.ts`), 그 안의 `sqlDiagnostics.errorNo`가 deadlock(1213)/lock wait
   * timeout(1205)이면 재시도 가능으로 본다. `BusinessException`이 아닌 에러(예: 커넥션 자체가
   * 끊겨 SP까지 도달하지 못하고 mysql2 드라이버가 직접 던진 에러)는 성격상 일시적인 네트워크
   * 문제일 가능성이 높아 재시도 가능으로 취급한다.
   */
  private isRetryableGenerationError(err: unknown): boolean {
    if (
      !(err instanceof BusinessException) ||
      err.resultCode !== ResultCode.DATABASE_ERROR
    ) {
      return true;
    }
    return RETRYABLE_MYSQL_ERROR_NOS.has(err.sqlDiagnostics?.errorNo ?? -1);
  }

  /** generation_status=4(실패) 전이 호출도 실패할 수 있으나, 이는 서버 로그로만 남긴다. */
  private async finalizeGenerationFailure(
    campaignId: number,
    errorMessage: string,
  ): Promise<void> {
    try {
      await this.spExecutor.callProcedure('SP_CAMPAIGN_CODE_GENERATION_FAIL', [
        campaignId,
        errorMessage,
      ]);
    } catch (err) {
      this.logger.error(
        `SP_CAMPAIGN_CODE_GENERATION_FAIL failed for campaign ${campaignId}: ${(err as Error).message}`,
      );
    }
  }

  /** nanoid 12자리 생성 후 use_hyphen이면 4자리씩 하이픈으로 묶는다(06_DATABASE_SCHEMA.md 6장). */
  private buildCodeValue(useHyphen: number): string {
    const raw = generateRandomCode();
    if (!useHyphen) {
      return raw;
    }
    return raw.match(/.{1,4}/g)!.join('-');
  }

  /** exponential backoff + jitter(07_COUPON_ISSUANCE_SCENARIO.md 2.2 표 — "DB 일시 오류" 행). */
  private backoffDelayMs(attempt: number): number {
    const exponential = this.generationRetryBaseDelayMs * 2 ** (attempt - 1);
    const jitter = 0.5 + Math.random() * 0.5;
    return Math.round(exponential * jitter);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * `POST /codes/abort`의 "정체 판정" 임계값(초) — 계산 공식 자체는 감지 전용 모니터링 크론
   * (`StaleCodeGenerationMonitorService`)과 공유해야 해서 `computeCodeGenerationStaleThresholdSec`
   * 공용 유틸로 옮겼다(2026-07-23, 스케일아웃 점검 5번). 이 메서드는 인스턴스 필드(env에서 읽은
   * 재시도 설정)를 그 유틸에 넘기는 얇은 래퍼로 남긴다.
   */
  private computeAbortStaleThresholdSec(): number {
    return computeCodeGenerationStaleThresholdSec({
      maxDbRetries: this.maxGenerationDbRetries,
      retryBaseDelayMs: this.generationRetryBaseDelayMs,
      staleSafetyMultiplier: this.abortStaleSafetyMultiplier,
    });
  }
}
