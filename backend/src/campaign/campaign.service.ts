import { Injectable } from '@nestjs/common';
import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { SpExecutorService } from '../common/database/sp-executor.service';
import { BusinessException } from '../common/response/business.exception';
import {
  buildPaginatedResult,
  PaginatedResult,
} from '../common/response/pagination';
import { ResultCode } from '../common/response/result-code.enum';
import { ChangeCampaignStatusDto } from './dto/change-campaign-status.dto';
import { CampaignListQueryDto } from './dto/campaign-list-query.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { RejectCampaignDto } from './dto/reject-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

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
  constructor(
    private readonly spExecutor: SpExecutorService,
    private readonly logSpExecutor: LogSpExecutorService,
  ) {}

  async create(
    dto: CreateCampaignDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignRow[]
    >('SP_CAMPAIGN_CREATE', [
      dto.project_id,
      dto.name,
      dto.campaign_start,
      dto.campaign_end,
      dto.code_type,
      dto.use_hyphen ?? 1,
      dto.requested_qty ?? 1,
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
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignRow[]
    >('SP_CAMPAIGN_GET_BY_ID', [campaignId, requester.userId]);

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
      CampaignRow[]
    >('SP_CAMPAIGN_UPDATE', [
      campaignId,
      dto.updated_at,
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
    return row;
  }

  async changeStatus(
    campaignId: number,
    dto: ChangeCampaignStatusDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignRow[]
    >('SP_CAMPAIGN_CHANGE_STATUS', [campaignId, dto.status, requesterUserId]);

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
    void this.logCampaignAction(
      CampaignLogAction.STATUS_CHANGE,
      row,
      requesterUserId,
    );
    return row;
  }

  async approve(
    campaignId: number,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignRow[]
    >('SP_CAMPAIGN_APPROVE', [campaignId, requesterUserId]);

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
    void this.logCampaignAction(CampaignLogAction.APPROVE, row, requesterUserId);
    return row;
  }

  async reject(
    campaignId: number,
    dto: RejectCampaignDto,
    requesterUserId: number,
  ): Promise<CampaignRow> {
    const { result, data } = await this.spExecutor.callProcedure<
      CampaignRow[]
    >('SP_CAMPAIGN_REJECT', [
      campaignId,
      dto.reject_reason,
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
    void this.logCampaignAction(CampaignLogAction.REJECT, row, requesterUserId);
    return row;
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
