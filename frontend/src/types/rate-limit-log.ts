import type { CouponUseAction } from './coupon-use-log';
import type { PaginationQuery } from './api';

/** log_coupon_rate_limit.limit_scope. 10:PROJECT, 20:USER. */
export type RateLimitScope = 10 | 20;

/** GET /coupon-rate-limit-logs 응답 items 항목. `action`은 log_coupon_use.action과 동일한
 * 코드 체계(10:RESERVE/20:CONFIRM)를 재사용한다. */
export interface RateLimitLogItem {
  idx: number;
  limit_scope: RateLimitScope;
  action: CouponUseAction;
  api_key: string;
  project_id: number | null;
  company_id: number | null;
  game_user_id: string | null;
  retry_after_sec: number;
  caller_ip: string | null;
  created_at: string;
}

/** GET /coupon-rate-limit-logs 쿼리 파라미터. 회사 필터는 화면 자체가 아닌 헤더의 전역 회사
 * 선택을 그대로 쓴다(감사 로그와 동일한 구조). */
export interface RateLimitLogListQuery extends PaginationQuery {
  company_id?: number;
  project_id?: number;
  limit_scope?: RateLimitScope;
  action?: CouponUseAction;
  game_user_id?: string;
  from_created_at?: string;
  to_created_at?: string;
}
