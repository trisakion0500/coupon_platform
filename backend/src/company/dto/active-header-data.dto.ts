import { ApiProperty } from '@nestjs/swagger';

class CompanyHeaderItemDto {
  @ApiProperty({ description: '회사 ID', example: 1 })
  company_id!: number;

  @ApiProperty({ description: '회사명', example: '에이씨엠이 게임즈' })
  company_name!: string;
}

class ProjectHeaderItemDto {
  @ApiProperty({ description: '프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiProperty({ description: '소속 회사 ID', example: 1 })
  company_id!: number;

  @ApiProperty({ description: '프로젝트명', example: '게임 프로젝트 A' })
  project_name!: string;
}

/**
 * GET /companies/active-header-data 응답. 12_COMPANY_API.md 3.1 — 로그인 직후 헤더
 * 콤보박스가 1회 로드하는 활성 회사·프로젝트 목록.
 *
 * @author trisakion
 */
export class ActiveHeaderDataDto {
  @ApiProperty({ description: '활성 회사 목록', type: [CompanyHeaderItemDto] })
  companies!: CompanyHeaderItemDto[];

  @ApiProperty({
    description: '활성 프로젝트 목록',
    type: [ProjectHeaderItemDto],
  })
  projects!: ProjectHeaderItemDto[];
}
