import { Transform } from 'class-transformer';
import { IsInt, IsString, Matches, MaxLength } from 'class-validator';

/**
 * GET /projects/lookup 쿼리 파라미터. 11_PROJECT_API.md 2.6 — 회원가입 화면 전용 공개 조회.
 *
 * @author trisakion
 */
export class ProjectLookupQueryDto {
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  company_id!: number;

  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(20)
  project_code!: string;
}
