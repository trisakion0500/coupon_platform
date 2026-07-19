import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * PATCH /companies/{company_id} 요청 바디. 10_COMPANY_API.md 2.4의 Updatable Fields만 받는다
 * (company_id/created_at은 DTO에 아예 없어 수정 대상이 될 수 없다).
 *
 * @author trisakion
 */
export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(20)
  company_code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  company_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  status?: number;
}
