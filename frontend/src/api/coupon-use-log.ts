import { apiClient } from '@/api/client';
import type { ApiEnvelope, PaginatedResult } from '@/types/api';
import type {
  CouponUseLogItem,
  CouponUseLogListQuery,
} from '@/types/coupon-use-log';

/** 19_CAMPAIGN_API.md 4.3 — project_id 단위 스코핑, 종료된 캠페인도 계속 조회 가능. */
export async function listCouponUseLogs(
  query: CouponUseLogListQuery,
): Promise<PaginatedResult<CouponUseLogItem>> {
  const { data } = await apiClient.get<
    ApiEnvelope<PaginatedResult<CouponUseLogItem>>
  >('/coupon-use-logs', { params: query });
  return data.data;
}
