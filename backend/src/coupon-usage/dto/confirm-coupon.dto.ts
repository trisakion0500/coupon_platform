import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * POST /v1/coupons/{code}/confirm 요청 바디. 18_COUPON_USAGE_API.md 2.2 Validation.
 *
 * `game_user_id`에 `@IsOptional()`을 붙인 이유는 `reserve-coupon.dto.ts`와 동일 —
 * `CouponUsageService.confirm`이 누락 체크를 명시적으로 수행해 30001을 정확히 반환한다.
 *
 * @author trisakion
 */
export class ConfirmCouponDto {
  @ApiProperty({ description: '게임 유저 ID', example: 'player_1001' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  game_user_id?: string;
}
