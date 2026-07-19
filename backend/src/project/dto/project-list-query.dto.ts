import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /projects 쿼리 파라미터. 11_PROJECT_API.md 2.2 — company_id/status는 선택.
 *
 * @author trisakion
 */
export class ProjectListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  company_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  status?: number;
}
