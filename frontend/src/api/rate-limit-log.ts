import { apiClient } from '@/api/client';
import type { ApiEnvelope, PaginatedResult } from '@/types/api';
import type {
  RateLimitLogItem,
  RateLimitLogListQuery,
} from '@/types/rate-limit-log';

/** 16_MENU_PERMISSION.md 2.6 — DEVELOPER는 서버가 본인 소속 회사(+역할보유 프로젝트)로 스코핑. */
export async function listRateLimitLogs(
  query: RateLimitLogListQuery,
): Promise<PaginatedResult<RateLimitLogItem>> {
  const { data } = await apiClient.get<
    ApiEnvelope<PaginatedResult<RateLimitLogItem>>
  >('/coupon-rate-limit-logs', { params: query });
  return data.data;
}
