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
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  company_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  project_id?: number;

  @IsOptional()
  @IsIn(TABLE_NAMES)
  table_name?: (typeof TABLE_NAMES)[number];

  @IsOptional()
  @IsString()
  target_id?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn(ACTIONS)
  action?: number;

  @IsOptional()
  @Matches(DATETIME_FORMAT)
  from_created_at?: string;

  @IsOptional()
  @Matches(DATETIME_FORMAT)
  to_created_at?: string;
}
