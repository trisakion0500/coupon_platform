import { ApiProperty } from '@nestjs/swagger';

/** POST /v1/coupons/{code}/reserve 응답. 18_COUPON_USAGE_API.md 2.1. */
export class ReserveResultDto {
  @ApiProperty({ description: '사용 이력 ID', example: 5001 })
  coupon_code_usage_id!: number;

  @ApiProperty({ description: '캠페인 ID', example: 100 })
  coupon_campaign_id!: number;

  @ApiProperty({ description: '코드 값', example: '23A4-B7C9-DEF2' })
  code_value!: string;

  @ApiProperty({ description: '게임 유저 ID', example: 'player_1001' })
  game_user_id!: string;

  @ApiProperty({
    description: '보상 내용(쿠폰서버는 해석하지 않고 그대로 전달)',
    example: { item_id: 1001, item_amount: 100 },
  })
  reward_data!: Record<string, unknown>;

  @ApiProperty({
    description: '사용(reserve)일시',
    example: '2026-07-26 10:00:00',
  })
  created_at!: string;
}

/** POST /v1/coupons/{code}/confirm 응답. 18_COUPON_USAGE_API.md 2.2. */
export class ConfirmResultDto {
  @ApiProperty({ description: '사용 이력 ID', example: 5001 })
  coupon_code_usage_id!: number;

  @ApiProperty({ description: '컨펌일시', example: '2026-07-26 10:01:00' })
  confirmed_at!: string;
}

/** GET /v1/coupons/unconfirmed 응답 항목. 18_COUPON_USAGE_API.md 3.1. */
export class UnconfirmedItemDto {
  @ApiProperty({ description: '코드 값', example: '23A4-B7C9-DEF2' })
  code_value!: string;

  @ApiProperty({ description: '게임 유저 ID', example: 'player_1001' })
  game_user_id!: string;

  @ApiProperty({ description: '캠페인 ID', example: 100 })
  coupon_campaign_id!: number;

  @ApiProperty({
    description: '보상 내용',
    example: { item_id: 1001, item_amount: 100 },
  })
  reward_data!: Record<string, unknown>;

  @ApiProperty({
    description: '사용(reserve)일시',
    example: '2026-07-26 10:00:00',
  })
  created_at!: string;
}
