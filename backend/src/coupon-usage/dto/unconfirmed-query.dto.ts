import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PAGE_SIZE_OPTIONS } from '../../common/response/pagination';
import type { PageSize } from '../../common/response/pagination';

/**
 * GET /v1/coupons/unconfirmed 쿼리 파라미터. 18_COUPON_USAGE_API.md 3.1.
 *
 * `page`/`page_size`는 형식만 여기서 검증한다 — "`game_user_id` 미지정 시 필수"라는 조건부
 * 필수 규칙은 30001(REQUIRED_FIELD_MISSING)로 정확히 응답해야 하는데, class-validator의
 * `@ValidateIf` 미충족은 ValidationPipe의 일반 BadRequestException(400 -> 30002)으로만
 * 떨어져 문서가 요구하는 코드와 어긋난다 — 그래서 그 조건부 필수 체크는
 * `CouponUsageService.listUnconfirmed`가 명시적으로 수행한다.
 *
 * @author trisakion
 */
export class UnconfirmedQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  game_user_id?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  campaign_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(PAGE_SIZE_OPTIONS)
  page_size?: PageSize;
}
