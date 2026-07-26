import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

const DATETIME_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const TABLE_NAMES = ['company', 'project', 'user', 'user_role'] as const;
const ACTIONS = [10, 20, 30] as const;

/**
 * GET /log-audits 쿼리 파라미터. 13_LOG_AUDIT_API.md 5장 — 전부 선택 필터.
 * `company_id`는 SUPER_ADMIN 호출 시에만 유효하고, DEVELOPER는 서비스 레이어가
 * 항상 자기 companyId로 덮어써 이 필드를 무시한다.
 *
 * @author trisakion
 */
export class LogAuditListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description:
      '회사 ID 필터(SUPER_ADMIN만 유효, DEVELOPER는 서버가 항상 자기 회사로 고정)',
    example: 1,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  company_id?: number;

  @ApiPropertyOptional({ description: '프로젝트 ID 필터', example: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  project_id?: number;

  @ApiPropertyOptional({ description: '대상 테이블 필터', enum: TABLE_NAMES })
  @IsOptional()
  @IsIn(TABLE_NAMES)
  table_name?: (typeof TABLE_NAMES)[number];

  @ApiPropertyOptional({ description: '대상 레코드 ID 필터', example: '1' })
  @IsOptional()
  @IsString()
  target_id?: string;

  @ApiPropertyOptional({
    description: '작업유형 필터(10:CREATE/20:UPDATE/30:STATUS_CHANGE)',
    enum: ACTIONS,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(ACTIONS)
  action?: number;

  @ApiPropertyOptional({
    description: '조회 시작일시',
    example: '2026-08-01 00:00:00',
  })
  @IsOptional()
  @Matches(DATETIME_FORMAT)
  from_created_at?: string;

  @ApiPropertyOptional({
    description: '조회 종료일시',
    example: '2026-08-31 23:59:59',
  })
  @IsOptional()
  @Matches(DATETIME_FORMAT)
  to_created_at?: string;
}
