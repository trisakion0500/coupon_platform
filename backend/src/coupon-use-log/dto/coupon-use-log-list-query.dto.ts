import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

const DATETIME_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ACTIONS = [10, 20] as const;
const RESULT_TYPES = [0, 10, 20, 30, 40, 50] as const;

/**
 * GET /coupon-use-logs 쿼리 파라미터. 17_CAMPAIGN_API.md 4.3 — `project_id`는 스코핑 기준이라
 * 필수지만, 미지정 시 정확히 30001(REQUIRED_FIELD_MISSING)로 응답해야 해서 여기서는 선택으로
 * 두고 `CouponUseLogService.list`가 명시적으로 체크한다(`UnconfirmedQueryDto`와 동일 이유 —
 * class-validator의 필수값 누락은 ValidationPipe의 일반 400(->30002)으로만 떨어진다).
 *
 * @author trisakion
 */
export class CouponUseLogListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  project_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  coupon_campaign_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  game_user_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code_value?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(ACTIONS)
  action?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(RESULT_TYPES)
  result_type?: number;

  @IsOptional()
  @Matches(DATETIME_FORMAT)
  from_created_at?: string;

  @IsOptional()
  @Matches(DATETIME_FORMAT)
  to_created_at?: string;
}
