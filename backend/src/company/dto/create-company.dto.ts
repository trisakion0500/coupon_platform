import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * POST /companies 요청 바디. 08_API_COMMON.md 7장 입력값 제약을 그대로 반영한다.
 *
 * @author trisakion
 */
export class CreateCompanyDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(20)
  company_code!: string;

  @IsString()
  @MaxLength(100)
  company_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
