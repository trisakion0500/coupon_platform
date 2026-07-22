import { IsString, MaxLength } from 'class-validator';

/**
 * POST /v1/coupons/{code}/reserve 요청 바디. 18_COUPON_USAGE_API.md 2.1 Validation.
 *
 * @author trisakion
 */
export class ReserveCouponDto {
  @IsString()
  @MaxLength(100)
  game_user_id!: string;
}
