import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * GET /coupon-rate-limit-logs 목록 항목. 16_MENU_PERMISSION.md 2.6.
 *
 * @author trisakion
 */
export class LogRateLimitListItemDto {
  @ApiProperty({ description: '로그 ID', example: 501 })
  idx!: number;

  @ApiProperty({ description: '리밋 종류(10:PROJECT/20:USER)', enum: [10, 20] })
  limit_scope!: number;

  @ApiProperty({
    description: '작업유형(10:RESERVE/20:CONFIRM)',
    enum: [10, 20],
  })
  action!: number;

  @ApiProperty({
    description: '요청 헤더 원문 API Key',
    example: 'abcd1234...',
  })
  api_key!: string;

  @ApiPropertyOptional({
    description: '해석된 프로젝트 ID(식별 불가 시 null)',
    example: 1,
    nullable: true,
  })
  project_id!: number | null;

  @ApiPropertyOptional({
    description: '해석된 회사 ID(식별 불가 시 null)',
    example: 1,
    nullable: true,
  })
  company_id!: number | null;

  @ApiPropertyOptional({
    description: 'USER 스코프에서만 채워짐(PROJECT 스코프는 null)',
    example: 'user-1',
    nullable: true,
  })
  game_user_id!: string | null;

  @ApiProperty({
    description: '거부 시점에 반환한 Retry-After 값(초)',
    example: 30,
  })
  retry_after_sec!: number;

  @ApiPropertyOptional({
    description: '호출한 게임서버의 IP',
    example: '127.0.0.1',
    nullable: true,
  })
  caller_ip!: string | null;

  @ApiProperty({
    description: '리젝트 발생 일시',
    example: '2026-08-06 10:00:00',
  })
  created_at!: string;
}
