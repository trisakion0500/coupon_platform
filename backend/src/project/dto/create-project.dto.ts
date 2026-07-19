import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * POST /projects 요청 바디. 08_API_COMMON.md 7장 입력값 제약을 그대로 반영한다.
 *
 * @author trisakion
 */
export class CreateProjectDto {
  @IsInt()
  company_id!: number;

  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(20)
  project_code!: string;

  @IsString()
  @MaxLength(100)
  project_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
