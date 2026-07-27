import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * POST /companies 요청 바디. 10_API_COMMON.md 7장 입력값 제약을 그대로 반영한다.
 *
 * @author trisakion
 */
export class CreateCompanyDto {
  @ApiProperty({
    description: '회사 코드(회원가입 화면에서 입력받는 식별자)',
    example: 'ACME',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(20)
  company_code!: string;

  @ApiProperty({ description: '회사명', example: '에이씨엠이 게임즈' })
  @IsString()
  @MaxLength(100)
  company_name!: string;

  @ApiPropertyOptional({ description: '설명', example: '모바일 RPG 퍼블리셔' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
