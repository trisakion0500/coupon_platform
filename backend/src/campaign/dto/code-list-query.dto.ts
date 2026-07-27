import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /campaigns/{coupon_campaign_id}/codes 쿼리 파라미터. 19_CAMPAIGN_API.md 3.3.
 *
 * @author trisakion
 */
export class CodeListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      '코드 상태 필터(0:중지/1:미사용(RANDOM)·사용중(FIXED)/2:사용완료(RANDOM))',
    enum: [0, 1, 2],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1, 2])
  status?: number;
}
