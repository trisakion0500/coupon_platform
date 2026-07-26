import { ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({
    description: '작업유형 필터(10:등록/20:수정/30:상태변경/40:승인/50:반려)',
    enum: ACTIONS,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(ACTIONS)
  action?: number;
}
