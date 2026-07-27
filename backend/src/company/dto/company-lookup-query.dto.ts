import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

/**
 * GET /companies/lookup 쿼리 파라미터. 12_COMPANY_API.md 2.5 — 회원가입 화면 전용 공개 조회.
 *
 * @author trisakion
 */
export class CompanyLookupQueryDto {
  @ApiProperty({ description: '회사 코드', example: 'ACME' })
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(20)
  company_code!: string;
}
