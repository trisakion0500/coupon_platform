import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

const ACTIONS = [10, 20, 30, 40, 50] as const;

/**
 * GET /campaigns/{coupon_campaign_id}/logs 쿼리 파라미터. 17_CAMPAIGN_API.md 4.2.
 *
 * @author trisakion
 */
export class CampaignLogListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(ACTIONS)
  action?: number;
}
