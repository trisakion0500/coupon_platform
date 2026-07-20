import { IsString, MaxLength } from 'class-validator';

/**
 * POST /campaigns/{coupon_campaign_id}/reject 요청 바디. 17_CAMPAIGN_API.md 2.7 Validation.
 *
 * @author trisakion
 */
export class RejectCampaignDto {
  @IsString()
  @MaxLength(500)
  reject_reason!: string;
}
