import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /campaigns/{coupon_campaign_id}/usages 쿼리 파라미터. 19_CAMPAIGN_API.md 4.1.
 *
 * @author trisakion
 */
export class UsageListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '게임 유저 ID 필터',
    example: 'player_1001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  game_user_id?: string;

  @ApiPropertyOptional({
    description: '컨펌 여부 필터(0:미컨슘만/1:컨펌완료만, 생략 시 전체)',
    enum: [0, 1],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  confirmed?: number;
}
