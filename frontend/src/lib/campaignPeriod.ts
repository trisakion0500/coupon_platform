import dayjs from 'dayjs';
import { getServerNow } from '@/lib/serverClock';

/**
 * 17_CAMPAIGN_API.md 2.5 — 활성화/재활성화 전이의 `campaign_end > NOW()` 조건과 정확히 반대
 * 경계를 쓴다(`campaign_end <= 서버 시각`이면 만료). 목록/상세 화면에서 사용기간이 이미 지난
 * 캠페인을 시각적으로 구분하는 데 공용으로 쓴다 — 브라우저 로컬 시계가 아니라 `getServerNow()`
 * (서버 오프셋 보정값)로 비교해야 관리자 기기 시계가 어긋나도 실제 서버 판정과 일치한다.
 */
export function isCampaignExpired(campaignEnd: string): boolean {
  return !dayjs(getServerNow()).isBefore(dayjs(campaignEnd));
}
