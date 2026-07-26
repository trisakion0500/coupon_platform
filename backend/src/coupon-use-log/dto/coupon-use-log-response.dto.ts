import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * GET /coupon-use-logs 응답 항목. 17_CAMPAIGN_API.md 4.3 — `coupon_campaign_id`가 null이면
 * (존재하지 않는 코드로 시도) `campaign_name`도 항상 null.
 *
 * @author trisakion
 */
export class CouponUseLogItemDto {
  @ApiProperty({ description: '로그 ID', example: 5001 })
  idx!: number;

  @ApiProperty({
    description: '작업유형(10:RESERVE/20:CONFIRM)',
    enum: [10, 20],
  })
  action!: number;

  @ApiProperty({ description: '프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiPropertyOptional({
    description: '캠페인 ID(코드 자체가 없는 시도면 null)',
    example: 100,
    nullable: true,
  })
  coupon_campaign_id!: number | null;

  @ApiPropertyOptional({
    description: '캠페인명',
    example: '여름 이벤트',
    nullable: true,
  })
  campaign_name!: string | null;

  @ApiProperty({ description: '코드 값', example: '23A4-B7C9-DEF2' })
  code_value!: string;

  @ApiProperty({ description: '게임 유저 ID', example: 'player_1001' })
  game_user_id!: string;

  @ApiProperty({
    description:
      '결과유형(0:성공/10:코드없음/20:이미소모·중지/30:캠페인 사용불가/40:사용자한도초과/50:소모기록없음)',
    enum: [0, 10, 20, 30, 40, 50],
  })
  result_type!: number;

  @ApiPropertyOptional({
    description: '호출한 게임서버 IP',
    example: '203.0.113.10',
    nullable: true,
  })
  caller_ip!: string | null;

  @ApiProperty({ description: '요청일시', example: '2026-07-26 10:00:00' })
  created_at!: string;
}
