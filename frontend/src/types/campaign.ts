import type { PaginationQuery } from '@/types/api';

/** 코드 발급 방식(coupon_campaign.code_type). */
export const CodeType = {
  RANDOM: 1,
  FIXED: 2,
} as const;
export type CodeType = (typeof CodeType)[keyof typeof CodeType];

/** 캠페인 라이프사이클(coupon_campaign.status). */
export const CampaignStatus = {
  PENDING: 1,
  ACTIVE: 2,
  PAUSED: 3,
  ENDED: 4,
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

/** 승인상태(coupon_campaign.approval_status) — status와 별개 축. */
export const ApprovalStatus = {
  NOT_REQUIRED: 1,
  PENDING: 2,
  APPROVED: 3,
  REJECTED: 4,
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

/** 코드 생성 진행상태(coupon_campaign.generation_status) — status/approval_status와 별개 축. */
export const GenerationStatus = {
  WAITING: 1,
  IN_PROGRESS: 2,
  DONE: 3,
  FAILED: 4,
} as const;
export type GenerationStatus = (typeof GenerationStatus)[keyof typeof GenerationStatus];

/** 17_CAMPAIGN_API.md 2장 — coupon_campaign 원본 컬럼 전체(GET /campaigns/{id} 등 단건 응답). */
export interface Campaign {
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
  reward_data: Record<string, unknown>;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  /** 낙관적 동시성 제어 토큰 — PATCH/status/approve/reject 요청 시 그대로 되돌려 보내야 한다. */
  edit_count: number;
}

/** 17_CAMPAIGN_API.md 2.2 GET /campaigns 목록 항목(요약 필드만, edit_count 없음). */
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

/** 17_CAMPAIGN_API.md 2.2 쿼리 파라미터 — project_id는 필수(회사 전체 조회 예외 없음). */
export interface CampaignListQuery extends PaginationQuery {
  project_id: number;
  status?: number;
  approval_status?: number;
  generation_status?: number;
  code_type?: number;
}

/** 17_CAMPAIGN_API.md 2.1 POST /campaigns 요청. */
export interface CreateCampaignRequest {
  project_id: number;
  name: string;
  campaign_start: string;
  campaign_end: string;
  code_type: number;
  use_hyphen?: number;
  requested_qty: number;
  use_limit_per_user?: number;
  reward_data: Record<string, unknown>;
}

/** 17_CAMPAIGN_API.md 2.4 PATCH /campaigns/{id} 요청 — edit_count 필수, 나머지 전부 선택. */
export interface UpdateCampaignRequest {
  edit_count: number;
  name?: string;
  campaign_start?: string;
  campaign_end?: string;
  use_limit_per_user?: number;
  usable_qty?: number;
  reward_data?: Record<string, unknown>;
}

/** 17_CAMPAIGN_API.md 2.5 POST /campaigns/{id}/status 요청. */
export interface ChangeCampaignStatusRequest {
  edit_count: number;
  status: number;
}

/** 17_CAMPAIGN_API.md 2.6 POST /campaigns/{id}/approve 요청. */
export interface ApproveCampaignRequest {
  edit_count: number;
}

/** 17_CAMPAIGN_API.md 2.7 POST /campaigns/{id}/reject 요청. */
export interface RejectCampaignRequest {
  edit_count: number;
  reject_reason: string;
}

/** 17_CAMPAIGN_API.md 3.1 POST /campaigns/{id}/codes 요청 — FIXED만 code_value를 보낸다. */
export interface IssueCodesRequest {
  code_value?: string;
}

/**
 * 17_CAMPAIGN_API.md 3.1 응답 — RANDOM(202)/FIXED(200) 공용. generated_qty/coupon_code는
 * FIXED 응답에만 존재한다(RANDOM은 백그라운드 진행 중이라 아직 알 수 없음).
 */
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

/** 17_CAMPAIGN_API.md 3.2/3.4 응답 — retry/abort 공용 셰이프. */
export interface CodeJobStatusResult {
  coupon_campaign_id: number;
  generation_status: number;
}

/** 17_CAMPAIGN_API.md 3.3 — coupon_code 목록 항목. status: 0=중지, 1=미사용(RANDOM)/사용중(FIXED), 2=사용완료(RANDOM). */
export interface CouponCode {
  coupon_code_id: number;
  code_value: string;
  status: number;
  created_at: string;
}

export interface CodeListQuery extends PaginationQuery {
  status?: number;
}

/** 17_CAMPAIGN_API.md 4.1 — 캠페인별 쿠폰 사용 이력 항목. confirmed_at이 null이면 미컨슘. */
export interface CampaignUsage {
  coupon_code_usage_id: number;
  code_value: string;
  game_user_id: string;
  confirmed_at: string | null;
  created_at: string;
}

export interface UsageListQuery extends PaginationQuery {
  game_user_id?: string;
  /** 0=미컨슘만 / 1=컨펌완료만, 생략 시 전체. */
  confirmed?: number;
}

/**
 * 17_CAMPAIGN_API.md 4.2 — log_coupon_campaign 스냅샷 항목. `log_audit`의 before/after_json
 * 방식이 아니라 그 시점 coupon_campaign 전체 스냅샷 1행이라, edit_count/generation_status/
 * generation_error/updated_by/updated_at은 이 로그에 없다(테이블 자체가 이 컬럼들을 안 둠).
 */
export interface CampaignLog {
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

export interface CampaignLogListQuery extends PaginationQuery {
  /** 10:CREATE/20:UPDATE/30:STATUS_CHANGE/40:APPROVE/50:REJECT. */
  action?: number;
}
