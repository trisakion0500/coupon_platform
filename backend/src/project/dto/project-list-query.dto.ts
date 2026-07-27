import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /projects 쿼리 파라미터. 13_PROJECT_API.md 2.2 — company_id/status는 선택.
 *
 * @author trisakion
 */
export class ProjectListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: '회사 ID 필터', example: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  company_id?: number;

  @ApiPropertyOptional({
    description: '상태 필터(0:중지/1:활성)',
    enum: [0, 1],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  status?: number;
}
