import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /campaigns/{coupon_campaign_id}/usages 쿼리 파라미터. 17_CAMPAIGN_API.md 4.1.
 *
 * @author trisakion
 */
export class UsageListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  game_user_id?: string;

  /** 0=미컨슘만 / 1=컨펌완료만, 생략 시 전체. */
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  confirmed?: number;
}
