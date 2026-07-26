import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/response/pagination';

/**
 * GET /campaigns 쿼리 파라미터. 17_CAMPAIGN_API.md 2.2 — project_id는 필수(company/project/
 * user 도메인과 달리 "회사 전체 조회" 예외가 없어 항상 프로젝트 단위로 스코핑한다), 나머지는 선택.
 *
 * @author trisakion
 */
export class CampaignListQueryDto extends PaginationQueryDto {
  @ApiProperty({ description: '프로젝트 ID(필수, 스코핑 기준)', example: 1 })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  project_id!: number;

  @ApiPropertyOptional({
    description: '상태 필터(1:대기/2:활성/3:일시중지/4:종료)',
    enum: [1, 2, 3, 4],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([1, 2, 3, 4])
  status?: number;

  @ApiPropertyOptional({
    description: '승인상태 필터(1:승인불요/2:승인대기/3:승인완료/4:반려)',
    enum: [1, 2, 3, 4],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([1, 2, 3, 4])
  approval_status?: number;

  @ApiPropertyOptional({
    description: '발급상태 필터(1:대기/2:진행중/3:완료/4:실패)',
    enum: [1, 2, 3, 4],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([1, 2, 3, 4])
  generation_status?: number;

  @ApiPropertyOptional({
    description: '코드 발급 방식 필터(1:RANDOM/2:FIXED)',
    enum: [1, 2],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([1, 2])
  code_type?: number;
}
