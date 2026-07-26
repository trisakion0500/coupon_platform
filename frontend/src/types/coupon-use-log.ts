import type { PaginationQuery } from '@/types/api';

/** 04_DATABASE_SCHEMA.md 11장 — log_coupon_use.action. 10:RESERVE/20:CONFIRM. */
export type CouponUseAction = 10 | 20;

/** 04_DATABASE_SCHEMA.md 11장 — log_coupon_use.result_type.
 * 0:성공/10:코드없음/20:이미소모·중지/30:캠페인 사용불가/40:사용자한도초과/50:소모기록없음(CONFIRM 전용). */
export type CouponUseResultType = 0 | 10 | 20 | 30 | 40 | 50;

/** 17_CAMPAIGN_API.md 4.3 GET /coupon-use-logs 응답 items 항목. campaign_name은
 * log_coupon_use 자체 컬럼이 아니라 coupon_campaign_id가 있는 행에 한해 서버가 메인 DB에서
 * 배치 조회해 붙인 값 — coupon_campaign_id가 null이면(존재하지 않는 코드로 시도) 항상 null. */
export interface CouponUseLogItem {
  idx: number;
  action: CouponUseAction;
  project_id: number;
  coupon_campaign_id: number | null;
  campaign_name: string | null;
  code_value: string;
  game_user_id: string;
  result_type: CouponUseResultType;
  caller_ip: string | null;
  created_at: string;
}

/** 17_CAMPAIGN_API.md 4.3 쿼리 파라미터. project_id는 헤더의 전역 프로젝트 선택을 그대로 쓴다
 * (15_SCREEN_LIST.md SCR-103). */
export interface CouponUseLogListQuery extends PaginationQuery {
  project_id: number;
  coupon_campaign_id?: number;
  game_user_id?: string;
  code_value?: string;
  action?: CouponUseAction;
  result_type?: CouponUseResultType;
  from_created_at?: string;
  to_created_at?: string;
}
