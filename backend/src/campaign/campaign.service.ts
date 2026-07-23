import { Injectable } from '@nestjs/common';
import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { ResultCode } from '../common/response/result-code.enum';
import { ApproveCampaignDto } from './dto/approve-campaign.dto';
import { CampaignLogListQueryDto } from './dto/campaign-log-list-query.dto';
import { ChangeCampaignStatusDto } from './dto/change-campaign-status.dto';
import { CampaignListQueryDto } from './dto/campaign-list-query.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { RejectCampaignDto } from './dto/reject-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { UsageListQueryDto } from './dto/usage-list-query.dto';

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

/**
 * CREATE/UPDATE/CHANGE_STATUS/APPROVE/REJECT 5개 SP 전용 반환 행 — log_coupon_campaign.
 * created_by_name(17_CAMPAIGN_API.md 4.2)을 채우기 위한 requester_name이 추가로 온다.
 * GET_BY_ID/LIST는 이 컬럼이 없어 CampaignRow를 그대로 쓴다. requester_name은 API 응답
 * 스키마에 없는 로그 전용 컬럼이라 controller로 나가는 반환값에서는 toPublicRow로 제외한다
 * (company/project/user 도메인과 동일 원칙 — 02_DEV_CONVENTIONS.md).
 */
interface CampaignActionRow extends CampaignRow {
  requester_name: string | null;
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

/**
 * SP_LOG_COUPON_CAMPAIGN_LIST(로그 DB) 반환 행 — coupon_campaign 컬럼 스냅샷 + action +
 * created_by_name(17_CAMPAIGN_API.md 4.2). reward_data는 log_coupon_campaign에서도 JSON
 * 타입 컬럼이라 mysql2가 자동 파싱한다(log_audit의 LONGTEXT before/after_json과 다름).
 */
interface CampaignLogListRow {
  idx: number | null;
  action: number | null;
  coupon_campaign_id: number | null;
  project_id: number | null;
  name: string | null;
  campaign_start: string | null;
  campaign_end: string | null;
  code_type: number | null;
  use_hyphen: number | null;
  requested_qty: number | null;
  generated_qty: number | null;
  usable_qty: number | null;
  used_qty: number | null;
  use_limit_per_user: number | null;
  status: number | null;
  approval_status: number | null;
  approved_by: number | null;
  approved_at: string | null;
  reject_reason: string | null;
  reward_data: Record<string, unknown> | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string | null;
  total_count: number;
}

export interface CampaignLogListItem {
  idx: number;
  action: number;
  coupon_campaign_id: number;
  project_id: number;
  name: string;
  campaign_start: string;
  campaign_end: string;
  code_type: number;
  use_hyphen: number;
  requested_qty: number;
  generated_qty: number;
  usable_qty: number;
  used_qty: number;
  use_limit_per_user: number;
  status: number;
  approval_status: number;
  approved_by: number | null;
  approved_at: string | null;
  reject_reason: string | null;
  reward_data: Record<string, unknown>;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
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
 * 17_CAMPAIGN_API.md 2장(Campaign) 7개 엔드포인트 + 4장(Read & Log APIs)의 비즈니스 로직.
 * company/project/user 도메인과 달리 "회사 전체 조회" 예외가 없고 SUPER_ADMIN 이외 전부
 * project_id 단위로만 스코핑한다 — 그 재검증은 전부 SP(FN_IS_SUPER_ADMIN/FN_GET_PROJECT_ROLE_CODE/
 * FN_CHECK_PROJECT_ACCESS) 쪽에서 수행하므로 이 서비스는 role_code를 넘기지 않고
 * requesterUserId만 전달한다. 코드 발급(3장)은 `CampaignCodeService`로 분리돼 있다
 * (2026-07-24 리팩터링 — 코드발급 로직까지 포함해 1100줄을 넘겼던 걸 CRUD/승인/조회와
 * 코드발급 백그라운드 처리로 나눔).
 *
 * @author trisakion
 */
@Injectable()
export class CampaignService {
  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly logSpExecutor: LogSpExecutorService,
  ) {}

  async create(
    dto: CreateCampaignDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignActionRow[]
    >('SP_CAMPAIGN_CREATE', [
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
    ]);

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
    return this.toPublicRow(row);
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
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignActionRow[]
    >('SP_CAMPAIGN_UPDATE', [
      campaignId,
      dto.edit_count,
      dto.name ?? null,
      dto.campaign_start ?? null,
      dto.campaign_end ?? null,
      dto.use_limit_per_user ?? null,
      dto.usable_qty ?? null,
      dto.reward_data ? JSON.stringify(dto.reward_data) : null,
      requesterUserId,
    ]);

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
    return this.toPublicRow(row);
  }

  async changeStatus(
    campaignId: number,
    dto: ChangeCampaignStatusDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignActionRow[]
    >('SP_CAMPAIGN_CHANGE_STATUS', [
      campaignId,
      dto.edit_count,
      dto.status,
      requesterUserId,
    ]);

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
    return this.toPublicRow(row);
  }

  async approve(
    campaignId: number,
    dto: ApproveCampaignDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignActionRow[]
    >('SP_CAMPAIGN_APPROVE', [campaignId, dto.edit_count, requesterUserId]);

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
    return this.toPublicRow(row);
  }

  async reject(
    campaignId: number,
    dto: RejectCampaignDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignActionRow[]
    >('SP_CAMPAIGN_REJECT', [
      campaignId,
      dto.edit_count,
      dto.reject_reason,
      requesterUserId,
    ]);

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
    return this.toPublicRow(row);
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
   * 캠페인 변경 이력 조회(17_CAMPAIGN_API.md 4.2) — 조회 전용, 캠페인 종료여부와 무관(1.3
   * 차단목록에 없음). log_coupon_campaign은 로그 DB에 있어 SP가 스스로 존재확인/스코핑을
   * 재검증하지 못하므로(02_DEV_CONVENTIONS.md 3.2 예외), getById가 이미 갖고 있는
   * 존재확인(31004)+스코핑(20001) 체크를 그대로 재사용해 메인 DB에서 먼저 통과시킨 뒤에만
   * 로그 DB(SP_LOG_COUPON_CAMPAIGN_LIST)를 조회하는 2단계 패턴이다.
   */
  async listLogs(
    campaignId: number,
    query: CampaignLogListQueryDto,
    requester: CampaignRequester,
  ): Promise<PaginatedResult<CampaignLogListItem>> {
    await this.getById(campaignId, requester);

    const offset = (query.page - 1) * query.page_size;
    const { result, data } = await this.logSpExecutor.callProcedure<
      CampaignLogListRow[]
    >('SP_LOG_COUPON_CAMPAIGN_LIST', [
      campaignId,
      query.action ?? null,
      query.page_size,
      offset,
    ]);

    if (result !== 0) {
      throw new BusinessException(ResultCode.INTERNAL_ERROR);
    }

    const rows = data ?? [];
    const totalCount = rows[0]?.total_count ?? 0;
    const items: CampaignLogListItem[] = rows
      .filter(
        (row): row is CampaignLogListRow & { idx: number } => row.idx !== null,
      )
      .map((row) => ({
        idx: row.idx,
        action: row.action!,
        coupon_campaign_id: row.coupon_campaign_id!,
        project_id: row.project_id!,
        name: row.name!,
        campaign_start: row.campaign_start!,
        campaign_end: row.campaign_end!,
        code_type: row.code_type!,
        use_hyphen: row.use_hyphen!,
        requested_qty: row.requested_qty!,
        generated_qty: row.generated_qty!,
        usable_qty: row.usable_qty!,
        used_qty: row.used_qty!,
        use_limit_per_user: row.use_limit_per_user!,
        status: row.status!,
        approval_status: row.approval_status!,
        approved_by: row.approved_by,
        approved_at: row.approved_at,
        reject_reason: row.reject_reason,
        reward_data: row.reward_data!,
        created_by: row.created_by!,
        created_by_name: row.created_by_name,
        created_at: row.created_at!,
      }));

    return buildPaginatedResult(query, totalCount, items);
  }

  /**
   * log_coupon_campaign 적재(로그 DB) — log_audit과 달리 before/after JSON이 아니라
   * coupon_campaign 컬럼을 그대로 복제하는 구조라(04_DATABASE_SCHEMA.md 10장) 도메인 SP가
   * 반환한 행을 그대로 전달하기만 하면 된다. LogSpExecutorService.logCall이 실패를 삼키므로
   * fire-and-forget으로 호출한다(02_DEV_CONVENTIONS.md 1장).
   */
  private async logCampaignAction(
    action: CampaignLogAction,
    row: CampaignActionRow,
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
      row.requester_name,
    ]);
  }

  /**
   * CampaignActionRow(requester_name 포함)를 공개 API 응답 스키마(CampaignRow)로 좁힌다.
   * requester_name은 log_coupon_campaign.created_by_name 채우기용 로그 전용 컬럼이라
   * 17_CAMPAIGN_API.md 응답 스펙에 없다 — 컨트롤러로 나가기 전에 명시적으로 제외한다
   * (company/project/user 도메인과 동일 원칙 — 02_DEV_CONVENTIONS.md).
   */
  private toPublicRow(row: CampaignActionRow): CampaignRow {
    return {
      coupon_campaign_id: row.coupon_campaign_id,
      project_id: row.project_id,
      name: row.name,
      campaign_start: row.campaign_start,
      campaign_end: row.campaign_end,
      code_type: row.code_type,
      use_hyphen: row.use_hyphen,
      requested_qty: row.requested_qty,
      generated_qty: row.generated_qty,
      generation_status: row.generation_status,
      generation_error: row.generation_error,
      usable_qty: row.usable_qty,
      used_qty: row.used_qty,
      use_limit_per_user: row.use_limit_per_user,
      status: row.status,
      approval_status: row.approval_status,
      approved_by: row.approved_by,
      approved_at: row.approved_at,
      reject_reason: row.reject_reason,
      reward_data: row.reward_data,
      created_by: row.created_by,
      updated_by: row.updated_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      edit_count: row.edit_count,
    };
  }
}
