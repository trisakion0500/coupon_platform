import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * PATCH /companies/{company_id} 요청 바디. 12_COMPANY_API.md 2.4의 Updatable Fields만 받는다
 * (company_id/created_at은 DTO에 아예 없어 수정 대상이 될 수 없다).
 *
 * @author trisakion
 */
export class UpdateCompanyDto {
  @ApiPropertyOptional({ description: '회사 코드', example: 'ACME' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(20)
  company_code?: string;

  @ApiPropertyOptional({ description: '회사명', example: '에이씨엠이 게임즈' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  company_name?: string;

  @ApiPropertyOptional({ description: '설명', example: '모바일 RPG 퍼블리셔' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: '상태(0:중지/1:활성)', enum: [0, 1] })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  status?: number;
}
