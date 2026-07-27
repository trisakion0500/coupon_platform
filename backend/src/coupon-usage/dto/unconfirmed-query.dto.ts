import { ApiPropertyOptional } from '@nestjs/swagger';
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
 * POST /v1/coupons/unconfirmed 요청 바디. 18_COUPON_USAGE_API.md 3.1.
 *
 * 원래 GET 쿼리 파라미터였으나(2026-07-27) `game_user_id` 등이 URL 쿼리스트링에 실려 접근/프록시
 * 로그에 그대로 남는 걸 피하기 위해 POST+바디로 전환했다 — 조회 성격은 그대로이므로
 * `@HttpCode(200)`을 유지한다(생성 API가 아니라서 201이 아니다).
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
  @ApiPropertyOptional({
    description:
      '특정 유저로 좁힘(지정 시 페이지네이션 없이 전체 반환, 미지정 시 page/page_size 필수)',
    example: 'player_1001',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  game_user_id?: string;

  @ApiPropertyOptional({ description: '캠페인 ID 필터', example: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  campaign_id?: number;

  @ApiPropertyOptional({
    description: '페이지 번호(game_user_id 미지정 시 필수)',
    example: 1,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: '페이지당 항목 수(game_user_id 미지정 시 필수)',
    enum: PAGE_SIZE_OPTIONS,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(PAGE_SIZE_OPTIONS)
  page_size?: PageSize;
}
