import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /campaigns/{coupon_campaign_id}/codes 쿼리 파라미터. 17_CAMPAIGN_API.md 3.3.
 *
 * @author trisakion
 */
export class CodeListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1, 2])
  status?: number;
}
