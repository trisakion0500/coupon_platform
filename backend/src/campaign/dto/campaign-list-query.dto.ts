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
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  project_id!: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([1, 2, 3, 4])
  status?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([1, 2, 3, 4])
  approval_status?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([1, 2, 3, 4])
  generation_status?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([1, 2])
  code_type?: number;
}
