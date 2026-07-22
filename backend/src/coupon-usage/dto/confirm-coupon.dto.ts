import { IsString, MaxLength } from 'class-validator';

/**
 * POST /v1/coupons/{code}/confirm 요청 바디. 18_COUPON_USAGE_API.md 2.2 Validation.
 *
 * @author trisakion
 */
export class ConfirmCouponDto {
  @IsString()
  @MaxLength(100)
  game_user_id!: string;
}
