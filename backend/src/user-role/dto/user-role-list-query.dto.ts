import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /user-roles 쿼리 파라미터. 12_USER_API.md 3.2 — 전부 선택 필터.
 *
 * @author trisakion
 */
export class UserRoleListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  user_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  project_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([10, 20, 30, 40])
  role_code?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  status?: number;
}
