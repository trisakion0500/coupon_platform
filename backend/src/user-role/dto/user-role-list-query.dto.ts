import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /user-roles 쿼리 파라미터. 12_USER_API.md 3.2 — 전부 선택 필터.
 *
 * @author trisakion
 */
export class UserRoleListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '사용자 ID 필터', example: 3 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  user_id?: number;

  @ApiPropertyOptional({ description: '프로젝트 ID 필터', example: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  project_id?: number;

  @ApiPropertyOptional({
    description: '역할 코드 필터',
    enum: [10, 20, 30, 40],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([10, 20, 30, 40])
  role_code?: number;

  @ApiPropertyOptional({
    description: '상태 필터(0:중지/1:활성)',
    enum: [0, 1],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  status?: number;
}
