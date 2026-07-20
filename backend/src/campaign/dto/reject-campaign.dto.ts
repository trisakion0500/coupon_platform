import { IsInt, IsString, MaxLength, Min } from 'class-validator';

/**
 * POST /campaigns/{coupon_campaign_id}/reject 요청 바디. 17_CAMPAIGN_API.md 2.7 Validation.
 *
 * `edit_count`는 필수다 — 낙관적 동시성 제어 토큰(17_CAMPAIGN_API.md 2.7 Concurrency,
 * SP_CAMPAIGN_UPDATE와 동일한 원칙).
 *
 * @author trisakion
 */
export class RejectCampaignDto {
  @IsInt()
  @Min(0)
  edit_count!: number;

  @IsString()
  @MaxLength(500)
  reject_reason!: string;
}
