import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * POST /v1/coupons/{code}/reserve 요청 바디. 20_COUPON_USAGE_API.md 2.1 Validation.
 *
 * `game_user_id`는 실제로는 필수지만 여기서는 `@IsOptional()`을 붙여둔다 — `unconfirmed-query.dto.ts`와
 * 동일한 이유로, `@IsString()`만으로 필드 누락을 잡으면 ValidationPipe의 일반 BadRequestException
 * (400 -> 30002 INVALID_FIELD_FORMAT)으로만 떨어져 문서가 요구하는 30001(REQUIRED_FIELD_MISSING)과
 * 어긋난다(test_game_server 6.5 에러 케이스 시나리오로 실제 재현됨, 2026-07-27). 그래서 "누락" 체크는
 * `CouponUsageService.reserve`가 명시적으로 수행하고, 이 데코레이터들은 "값이 있을 때의 형식"만 검증한다.
 *
 * @author trisakion
 */
export class ReserveCouponDto {
  @ApiProperty({ description: '게임 유저 ID', example: 'player_1001' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  game_user_id?: string;
}
