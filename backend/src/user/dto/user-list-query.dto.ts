import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /users 쿼리 파라미터. 14_USER_API.md 1.1/1.2 — company_id/status는 선택
 * (company_id는 SUPER_ADMIN만 유효, DEVELOPER는 서비스가 항상 자기 회사로 고정).
 *
 * @author trisakion
 */
export class UserListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '회사 ID 필터(SUPER_ADMIN만 유효)',
    example: 1,
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  company_id?: number;

  @ApiPropertyOptional({
    description: '상태 필터(0:가입승인대기/1:가입승인/2:가입반려/3:사용중지)',
    enum: [0, 1, 2, 3],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1, 2, 3])
  status?: number;
}
