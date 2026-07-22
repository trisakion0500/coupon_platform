import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { customAlphabet } from 'nanoid';
import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { ResultCode } from '../common/response/result-code.enum';
import { ApproveCampaignDto } from './dto/approve-campaign.dto';
import { ChangeCampaignStatusDto } from './dto/change-campaign-status.dto';
import { CampaignListQueryDto } from './dto/campaign-list-query.dto';
import { CodeListQueryDto } from './dto/code-list-query.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { IssueCodesDto } from './dto/issue-codes.dto';
import { RejectCampaignDto } from './dto/reject-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { UsageListQueryDto } from './dto/usage-list-query.dto';

/**
 * RANDOM 코드값 생성 규칙(04_DATABASE_SCHEMA.md 6장) —
 * 혼동하기 쉬운 문자(0/1/I/O)를 뺀 32자 알파벳으로 12자리를 뽑고, use_hyphen이면
 * 4자리씩 하이픈으로 묶는다(`XXXX-XXXX-XXXX`).
 */
const generateRandomCode = customAlphabet(
  '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
  12,
);

/**
 * `SP_CAMPAIGN_CODE_GENERATE_ONE`이 SQLEXCEPTION으로 실패했을 때(RESULT=50001) 재시도할
 * 가치가 있다고 보는 MySQL 에러번호 — `05_COUPON_ISSUANCE_SCENARIO.md` 2.2가 예로 든
 * "deadlock, lock wait timeout"에 정확히 대응한다(ER_LOCK_DEADLOCK/ER_LOCK_WAIT_TIMEOUT).
 * 이 집합에 없는 에러(예: 제약 위반류)는 몇 번을 재시도해도 결과가 달라지지 않으므로 즉시
 * 실패 처리한다(`isRetryableGenerationError` 참고).
 */
const RETRYABLE_MYSQL_ERROR_NOS = new Set([1205, 1213]);

/** coupon_campaign 전체 컬럼 — 모든 쓰기 SP가 이 형태로 결과 행을 반환한다. */
export interface CampaignRow {
  coupon_campaign_id: number;
  project_id: number;
  name: string;
  campaign_start: string;
  campaign_end: string;
  code_type: number;
  use_hyphen: number;
  requested_qty: number;
  generated_qty: number;
  generation_status: number;
  generation_error: string | null;
  usable_qty: number;
  used_qty: number;
  use_limit_per_user: number;
  status: number;
  approval_status: number;
  approved_by: number | null;
  approved_at: string | null;
  reject_reason: string | null;
  /** JSON 컬럼 — mysql2가 조회 시 자동으로 JS 객체로 파싱해 반환한다. */
  reward_data: Record<string, unknown>;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  /** 낙관적 동시성 제어 토큰 — PATCH /campaigns/{id} 요청 시 이 값을 그대로 되돌려 보내야 한다. */
  edit_count: number;
}

/** SP_CAMPAIGN_LIST 반환 행 — 목록용 축약 컬럼 + total_count. */
interface CampaignListRow {
  coupon_campaign_id: number | null;
  project_id: number;
  name: string;
  code_type: number;
  requested_qty: number;
  generated_qty: number;
  generation_status: number;
  usable_qty: number;
  used_qty: number;
  status: number;
  approval_status: number;
  campaign_start: string;
  campaign_end: string;
  created_at: string;
  updated_at: string;
  total_count: number;
}

export interface CampaignListItem {
  coupon_campaign_id: number;
  project_id: number;
  name: string;
  code_type: number;
  requested_qty: number;
  generated_qty: number;
  generation_status: number;
  usable_qty: number;
  used_qty: number;
  status: number;
  approval_status: number;
  campaign_start: string;
  campaign_end: string;
  created_at: string;
  updated_at: string;
}

/** 요청자 컨텍스트 — JwtAuthGuard가 검증한 JWT 페이로드 값(DB 재조회 없이 신뢰). */
export interface CampaignRequester {
  userId: number;
}

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

/** POST /campaigns/{id}/codes 응답(17_CAMPAIGN_API.md 3.1) — FIXED만 generated_qty/coupon_code를 포함한다. */
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

/** POST /campaigns/{id}/codes/retry 응답(17_CAMPAIGN_API.md 3.2). */
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

/** SP_CAMPAIGN_USAGE_LIST 반환 행 — 사용이력 목록용 컬럼 + total_count. */
interface UsageListRow {
  coupon_code_usage_id: number | null;
  code_value: string;
  game_user_id: string;
  confirmed_at: string | null;
  created_at: string;
  total_count: number;
}

export interface UsageListItem {
  coupon_code_usage_id: number;
  code_value: string;
  game_user_id: string;
  confirmed_at: string | null;
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
 * 종료됨 — 05_COUPON_ISSUANCE_SCENARIO.md 2.4 참고, 둘은 별개 축이라 함께 확인해야 한다).
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

/** POST /campaigns/{id}/codes/abort 응답(17_CAMPAIGN_API.md 3.4). */
export interface AbortCodeGenerationResult {
  coupon_campaign_id: number;
  generation_status: number;
}

/** log_coupon_campaign 작업유형(04_DATABASE_SCHEMA.md 10장). */
enum CampaignLogAction {
  CREATE = 10,
  UPDATE = 20,
  STATUS_CHANGE = 30,
  APPROVE = 40,
  REJECT = 50,
}

/**
 * 17_CAMPAIGN_API.md 2장(Campaign) 7개 엔드포인트의 비즈니스 로직. company/project/user
 * 도메인과 달리 "회사 전체 조회" 예외가 없고 SUPER_ADMIN 이외 전부 project_id 단위로만
 * 스코핑한다 — 그 재검증은 전부 SP(FN_IS_SUPER_ADMIN/FN_GET_PROJECT_ROLE_CODE/
 * FN_CHECK_PROJECT_ACCESS) 쪽에서 수행하므로 이 서비스는 role_code를 넘기지 않고
 * requesterUserId만 전달한다.
 *
 * @author trisakion
 */
@Injectable()
export class CampaignService {
  private readonly logger = new Logger(CampaignService.name);
  /** RANDOM 코드 생성 중 DB 일시 오류가 나면 재시도할 최대 횟수(05_COUPON_ISSUANCE_SCENARIO.md 2.2). */
  private readonly maxGenerationDbRetries: number;
  /** exponential backoff 기준 지연(ms) — 시도마다 2배씩 늘어난다. */
  private readonly generationRetryBaseDelayMs: number;
  /** abort 임계값(초) 계산용 안전 배율(05_COUPON_ISSUANCE_SCENARIO.md 2.4). */
  private readonly abortStaleSafetyMultiplier: number;

  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly logSpExecutor: LogSpExecutorService,
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

  async create(
    dto: CreateCampaignDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<CampaignRow[]>(
      'SP_CAMPAIGN_CREATE',
      [
        dto.project_id,
        dto.name,
        dto.campaign_start,
        dto.campaign_end,
        dto.code_type,
        dto.use_hyphen ?? 1,
        dto.requested_qty,
        dto.use_limit_per_user ?? 1,
        JSON.stringify(dto.reward_data),
        requesterUserId,
      ],
    );

    if (result === 31002) {
      throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    void this.logCampaignAction(CampaignLogAction.CREATE, row, requesterUserId);
    return row;
  }

  async list(
    query: CampaignListQueryDto,
    requester: CampaignRequester,
  ): Promise<PaginatedResult<CampaignListItem>> {
    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignListRow[]
    >('SP_CAMPAIGN_LIST', [
      query.project_id,
      query.status ?? null,
      query.approval_status ?? null,
      query.generation_status ?? null,
      query.code_type ?? null,
      query.page_size,
      offset,
      requester.userId,
    ]);

    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const totalCount = rows[0]?.total_count ?? 0;
    const items: CampaignListItem[] = rows
      .filter(
        (row): row is CampaignListRow & { coupon_campaign_id: number } =>
          row.coupon_campaign_id !== null,
      )
      .map((row) => ({
        coupon_campaign_id: row.coupon_campaign_id,
        project_id: row.project_id,
        name: row.name,
        code_type: row.code_type,
        requested_qty: row.requested_qty,
        generated_qty: row.generated_qty,
        generation_status: row.generation_status,
        usable_qty: row.usable_qty,
        used_qty: row.used_qty,
        status: row.status,
        approval_status: row.approval_status,
        campaign_start: row.campaign_start,
        campaign_end: row.campaign_end,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));

    return buildPaginatedResult(query, totalCount, items);
  }

  async getById(
    campaignId: number,
    requester: CampaignRequester,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<CampaignRow[]>(
      'SP_CAMPAIGN_GET_BY_ID',
      [campaignId, requester.userId],
    );

    if (result === 31004) {
      throw new BusinessException(ResultCode.CAMPAIGN_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    return data[0];
  }

  async update(
    campaignId: number,
    dto: UpdateCampaignDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<CampaignRow[]>(
      'SP_CAMPAIGN_UPDATE',
      [
        campaignId,
        dto.edit_count,
        dto.name ?? null,
        dto.campaign_start ?? null,
        dto.campaign_end ?? null,
        dto.use_limit_per_user ?? null,
        dto.usable_qty ?? null,
        dto.reward_data ? JSON.stringify(dto.reward_data) : null,
        requesterUserId,
      ],
    );

    if (result === 31004) {
      throw new BusinessException(ResultCode.CAMPAIGN_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 30005) {
      throw new BusinessException(ResultCode.UPDATE_CONFLICT);
    }
    if (result === 30004) {
      throw new BusinessException(ResultCode.INVALID_STATE_TRANSITION);
    }
    if (result === 30003) {
      throw new BusinessException(ResultCode.DISALLOWED_VALUE);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    void this.logCampaignAction(CampaignLogAction.UPDATE, row, requesterUserId);
    return row;
  }

  async changeStatus(
    campaignId: number,
    dto: ChangeCampaignStatusDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<CampaignRow[]>(
      'SP_CAMPAIGN_CHANGE_STATUS',
      [campaignId, dto.edit_count, dto.status, requesterUserId],
    );

    if (result === 31004) {
      throw new BusinessException(ResultCode.CAMPAIGN_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 30005) {
      throw new BusinessException(ResultCode.UPDATE_CONFLICT);
    }
    if (result === 30004) {
      throw new BusinessException(ResultCode.INVALID_STATE_TRANSITION);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    void this.logCampaignAction(
      CampaignLogAction.STATUS_CHANGE,
      row,
      requesterUserId,
    );
    return row;
  }

  async approve(
    campaignId: number,
    dto: ApproveCampaignDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<CampaignRow[]>(
      'SP_CAMPAIGN_APPROVE',
      [campaignId, dto.edit_count, requesterUserId],
    );

    if (result === 31004) {
      throw new BusinessException(ResultCode.CAMPAIGN_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 30005) {
      throw new BusinessException(ResultCode.UPDATE_CONFLICT);
    }
    if (result === 30004) {
      throw new BusinessException(ResultCode.INVALID_STATE_TRANSITION);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    void this.logCampaignAction(
      CampaignLogAction.APPROVE,
      row,
      requesterUserId,
    );
    return row;
  }

  async reject(
    campaignId: number,
    dto: RejectCampaignDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<CampaignRow[]>(
      'SP_CAMPAIGN_REJECT',
      [campaignId, dto.edit_count, dto.reject_reason, requesterUserId],
    );

    if (result === 31004) {
      throw new BusinessException(ResultCode.CAMPAIGN_NOT_FOUND);
    }
    if (result === 20001) {
      throw new BusinessException(ResultCode.PERMISSION_DENIED);
    }
    if (result === 30005) {
      throw new BusinessException(ResultCode.UPDATE_CONFLICT);
    }
    if (result === 30004) {
      throw new BusinessException(ResultCode.INVALID_STATE_TRANSITION);
    }
    if (result !== 0 || !data?.[0]) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const row = data[0];
    void this.logCampaignAction(CampaignLogAction.REJECT, row, requesterUserId);
    return row;
  }

  /**
   * 코드 발급 요청(17_CAMPAIGN_API.md 3.1). SP가 generation_status 1->2 선점까지 원자적으로
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
   * 코드 생성 재시도(17_CAMPAIGN_API.md 3.2) — generation_status=4(실패)에서만 허용된다. 이미
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
   * 진행중(generation_status=2) 정체 캠페인 수동 복구(17_CAMPAIGN_API.md 3.4,
   * 05_COUPON_ISSUANCE_SCENARIO.md 2.4) — 서버 프로세스 재시작 등으로 백그라운드 루프가
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

  /** 캠페인별 쿠폰 코드 목록 조회(17_CAMPAIGN_API.md 3.3) — 조회 전용, 승인상태와 무관. */
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
   * 캠페인별 쿠폰 사용 이력 조회(17_CAMPAIGN_API.md 4.1) — 조회 전용, 승인상태/캠페인 종료여부와
   * 무관(1.3 차단목록에 없음). game_user_id/confirmed 둘 다 선택 필터.
   */
  async listUsages(
    campaignId: number,
    query: UsageListQueryDto,
    requester: CampaignRequester,
  ): Promise<PaginatedResult<UsageListItem>> {
    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.spExecutor.callProcedure<
      UsageListRow[]
    >('SP_CAMPAIGN_USAGE_LIST', [
      campaignId,
      query.game_user_id ?? null,
      query.confirmed ?? null,
      query.page_size,
      offset,
      requester.userId,
    ]);

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
    const items: UsageListItem[] = rows
      .filter(
        (row): row is UsageListRow & { coupon_code_usage_id: number } =>
          row.coupon_code_usage_id !== null,
      )
      .map((row) => ({
        coupon_code_usage_id: row.coupon_code_usage_id,
        code_value: row.code_value,
        game_user_id: row.game_user_id,
        confirmed_at: row.confirmed_at,
        created_at: row.created_at,
      }));

    return buildPaginatedResult(query, totalCount, items);
  }

  /**
   * RANDOM 코드 대량생성 백그라운드 루프(05_COUPON_ISSUANCE_SCENARIO.md 2.1~2.2) — issueCodes/
   * retryCodeIssuance가 `void`로 fire-and-forget 호출한다. HTTP 응답과 완전히 분리되어 있으므로
   * 이 메서드가 던지는 예외는 아무도 받지 않는다 — 그래서 모든 실패 경로를 내부에서 직접
   * 처리하고 밖으로 던지지 않는다.
   *
   * - 코드값 충돌(32001): backoff 없이 즉시 새 값으로 재시도(단순 재추첨이라 외부 자원 경합이
   *   아님)
   * - SP 계약 위반(RESULT가 0/32001 어느 쪽도 아님): 재시도해도 절대 나아지지 않는 로직 버그이므로
   *   재시도 예산을 쓰지 않고 즉시 실패 처리
   * - DB 일시 오류(SP_CAMPAIGN_CODE_GENERATE_ONE이 50001로 throw): `isRetryableGenerationError`로
   *   실제 재시도할 가치가 있는 에러인지 먼저 가려낸 뒤(05_COUPON_ISSUANCE_SCENARIO.md 2.2 —
   *   "재시도 가능 에러만 대상, 4xx류 등은 즉시 실패 처리"), 재시도 가능하면 exponential
   *   backoff+jitter로 최대 MAX_GENERATION_DB_RETRIES회 재시도, 그 외엔 즉시 실패 처리. 소진/즉시
   *   실패 모두 SP_CAMPAIGN_CODE_GENERATION_FAIL 호출로 이어진다
   * - job을 빼앗김(SP가 돌려준 generation_status가 더 이상 2가 아님 — 예: 관리자가
   *   POST /codes/abort로 이 job을 강제 종료시킴) 또는 캠페인 자체가 종료됨(status=4 —
   *   generation_status와 별개 축이라 따로 확인): 누군가 이미 최종 상태를 결정했다는 뜻이므로
   *   COMPLETE/FAIL을 또 호출하지 않고 조용히 루프만 종료한다(05_COUPON_ISSUANCE_SCENARIO.md 2.4)
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
   * SP 내부 SQLEXCEPTION 중 재시도할 가치가 있는 것만 가려낸다(05_COUPON_ISSUANCE_SCENARIO.md
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

  /** nanoid 12자리 생성 후 use_hyphen이면 4자리씩 하이픈으로 묶는다(04_DATABASE_SCHEMA.md 6장). */
  private buildCodeValue(useHyphen: number): string {
    const raw = generateRandomCode();
    if (!useHyphen) {
      return raw;
    }
    return raw.match(/.{1,4}/g)!.join('-');
  }

  /** exponential backoff + jitter(05_COUPON_ISSUANCE_SCENARIO.md 2.2 표 — "DB 일시 오류" 행). */
  private backoffDelayMs(attempt: number): number {
    const exponential = this.generationRetryBaseDelayMs * 2 ** (attempt - 1);
    const jitter = 0.5 + Math.random() * 0.5;
    return Math.round(exponential * jitter);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * `POST /codes/abort`의 "정체 판정" 임계값(초)을 별도 env 없이 기존 재시도 설정에서 계산한다
   * (05_COUPON_ISSUANCE_SCENARIO.md 2.4). 정상적으로 살아있는 루프가 DB 일시 오류로 재시도할 때
   * 만들 수 있는 이론상 최대 무진행 구간(jitter 최대치 1.0 가정)은 backoff 누적합
   * `baseDelay × (2^retries − 1)`이므로, 여기에 안전 배율을 곱한다 — 재시도 설정이 바뀌면 이
   * 임계값도 자동으로 같이 늘어나 두 설정이 서로 어긋날 일이 없다.
   */
  private computeAbortStaleThresholdSec(): number {
    const worstCaseRetryWindowMs =
      this.generationRetryBaseDelayMs * (2 ** this.maxGenerationDbRetries - 1);
    return Math.ceil(
      (worstCaseRetryWindowMs * this.abortStaleSafetyMultiplier) / 1000,
    );
  }

  /**
   * log_coupon_campaign 적재(로그 DB) — log_audit과 달리 before/after JSON이 아니라
   * coupon_campaign 컬럼을 그대로 복제하는 구조라(04_DATABASE_SCHEMA.md 10장) 도메인 SP가
   * 반환한 행을 그대로 전달하기만 하면 된다. LogSpExecutorService.logCall이 실패를 삼키므로
   * fire-and-forget으로 호출한다(02_DEV_CONVENTIONS.md 1장).
   */
  private async logCampaignAction(
    action: CampaignLogAction,
    row: CampaignRow,
    requesterUserId: number,
  ): Promise<void> {
    await this.logSpExecutor.logCall('SP_LOG_COUPON_CAMPAIGN_CREATE', [
      action,
      row.coupon_campaign_id,
      row.project_id,
      row.name,
      row.campaign_start,
      row.campaign_end,
      row.code_type,
      row.use_hyphen,
      row.requested_qty,
      row.generated_qty,
      row.usable_qty,
      row.used_qty,
      row.use_limit_per_user,
      row.status,
      row.approval_status,
      row.approved_by,
      row.approved_at,
      row.reject_reason,
      JSON.stringify(row.reward_data),
      requesterUserId,
    ]);
  }
}
