import { IsIn } from 'class-validator';

/**
 * POST /campaigns/{coupon_campaign_id}/status 요청 바디. 17_CAMPAIGN_API.md 2.5 전이표상
 * 목표 상태는 2(활성)/3(일시중지)/4(종료)뿐이다 — 1(대기)로 되돌아가는 전이는 존재하지 않는다.
 * 실제 전이 가능 여부(현재 상태·승인상태 조합)는 SP_CAMPAIGN_CHANGE_STATUS의 조건부 UPDATE가
 * 최종 검증한다.
 *
 * @author trisakion
 */
export class ChangeCampaignStatusDto {
  @IsIn([2, 3, 4])
  status!: number;
}
