import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /companies 쿼리 파라미터. 10_COMPANY_API.md 2.2 — status는 선택, 미지정 시 전체 조회.
 *
 * @author trisakion
 */
export class CompanyListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: '상태 필터(0:중지/1:활성, 미지정 시 전체)',
    enum: [0, 1],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  status?: number;
}
