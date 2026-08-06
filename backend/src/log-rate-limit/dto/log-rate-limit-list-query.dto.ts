import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

const DATETIME_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const LIMIT_SCOPES = [10, 20] as const;
const ACTIONS = [10, 20] as const;

/**
 * GET /coupon-rate-limit-logs 쿼리 파라미터. 16_MENU_PERMISSION.md 2.6 — 전부 선택 필터.
 * `company_id`는 SUPER_ADMIN 호출 시에만 유효하고, DEVELOPER는 서비스 레이어가 항상 자기
 * companyId로 덮어써 이 필드를 무시한다(LogAuditListQueryDto와 동일한 관례).
 *
 * @author trisakion
 */
export class LogRateLimitListQueryDto extends PaginationQueryDto {
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

  @ApiPropertyOptional({
    description: '리밋 종류 필터(10:PROJECT/20:USER)',
    enum: LIMIT_SCOPES,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(LIMIT_SCOPES)
  limit_scope?: number;

  @ApiPropertyOptional({
    description: '작업유형 필터(10:RESERVE/20:CONFIRM)',
    enum: ACTIONS,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(ACTIONS)
  action?: number;

  @ApiPropertyOptional({ description: '게임 유저 ID 필터', example: 'user-1' })
  @IsOptional()
  @IsString()
  game_user_id?: string;

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
