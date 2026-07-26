import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 회사 응답 셰이프(생성/목록/상세/수정 공통). 10_COMPANY_API.md.
 *
 * @author trisakion
 */
export class CompanyResponseDto {
  @ApiProperty({ description: '회사 ID', example: 1 })
  company_id!: number;

  @ApiProperty({ description: '회사 코드', example: 'ACME' })
  company_code!: string;

  @ApiProperty({ description: '회사명', example: '에이씨엠이 게임즈' })
  company_name!: string;

  @ApiPropertyOptional({
    description: '설명',
    example: '모바일 RPG 퍼블리셔',
    nullable: true,
  })
  description!: string | null;

  @ApiProperty({ description: '상태(0:중지/1:활성)', enum: [0, 1] })
  status!: number;

  @ApiProperty({ description: '생성일시', example: '2026-07-01 09:00:00' })
  created_at!: string;

  @ApiProperty({ description: '수정일시', example: '2026-07-01 09:00:00' })
  updated_at!: string;
}

/** GET /companies/lookup 응답(회원가입 화면 전용, 인증 불필요). */
export class CompanyLookupResponseDto {
  @ApiProperty({ description: '회사 ID', example: 1 })
  company_id!: number;

  @ApiProperty({ description: '회사명', example: '에이씨엠이 게임즈' })
  company_name!: string;
}
