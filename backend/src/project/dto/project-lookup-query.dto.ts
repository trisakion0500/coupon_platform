import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsString, Matches, MaxLength } from 'class-validator';

/**
 * GET /projects/lookup 쿼리 파라미터. 11_PROJECT_API.md 2.6 — 회원가입 화면 전용 공개 조회.
 *
 * @author trisakion
 */
export class ProjectLookupQueryDto {
  @ApiProperty({ description: '소속 회사 ID', example: 1 })
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  company_id!: number;

  @ApiProperty({ description: '프로젝트 코드', example: 'GAME01' })
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(20)
  project_code!: string;
}
