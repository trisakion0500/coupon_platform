import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /users 쿼리 파라미터. 12_USER_API.md 1.1/1.2 — company_id/status는 선택
 * (company_id는 SUPER_ADMIN만 유효, DEVELOPER는 서비스가 항상 자기 회사로 고정).
 *
 * @author trisakion
 */
export class UserListQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  company_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1, 2, 3])
  status?: number;
}
