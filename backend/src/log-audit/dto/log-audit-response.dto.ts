import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * GET /log-audits 목록 항목. 15_LOG_AUDIT_API.md 5장.
 *
 * @author trisakion
 */
export class LogAuditListItemDto {
  @ApiProperty({ description: '로그 ID', example: 501 })
  idx!: number;

  @ApiPropertyOptional({ description: '회사 ID', example: 1, nullable: true })
  company_id!: number | null;

  @ApiPropertyOptional({
    description: '프로젝트 ID',
    example: 1,
    nullable: true,
  })
  project_id!: number | null;

  @ApiProperty({
    description: '대상 테이블',
    enum: ['company', 'project', 'user', 'user_role'],
  })
  table_name!: string;

  @ApiProperty({ description: '대상 레코드 ID', example: '1' })
  target_id!: string;

  @ApiPropertyOptional({
    description: '대상 이름(예: 회사명/사용자명)',
    example: '에이씨엠이 게임즈',
    nullable: true,
  })
  target_name!: string | null;

  @ApiProperty({
    description: '작업유형(10:CREATE/20:UPDATE/30:STATUS_CHANGE)',
    enum: [10, 20, 30],
  })
  action!: number;

  @ApiProperty({ description: '작업자 사용자 ID', example: 1 })
  created_by!: number;

  @ApiPropertyOptional({
    description: '작업자 이름',
    example: '관리자',
    nullable: true,
  })
  created_by_name!: string | null;

  @ApiProperty({ description: '작업일시', example: '2026-07-26 10:00:00' })
  created_at!: string;
}

/** GET /log-audits/{idx} 응답 — before_json/after_json 포함. */
export class LogAuditDetailDto extends LogAuditListItemDto {
  @ApiPropertyOptional({
    description:
      '수정 전 값(CREATE 액션이면 null, password_hash/api_secret류는 마스킹됨)',
    example: null,
    nullable: true,
  })
  before_json!: Record<string, unknown> | null;

  @ApiProperty({
    description: '수정 후 값(password_hash/api_secret류는 마스킹됨)',
    example: { company_name: '에이씨엠이 게임즈' },
  })
  after_json!: Record<string, unknown>;
}
