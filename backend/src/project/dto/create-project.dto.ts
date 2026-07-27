import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * POST /projects 요청 바디. 10_API_COMMON.md 7장 입력값 제약을 그대로 반영한다.
 *
 * @author trisakion
 */
export class CreateProjectDto {
  @ApiProperty({ description: '소속 회사 ID', example: 1 })
  @IsInt()
  company_id!: number;

  @ApiProperty({ description: '프로젝트 코드', example: 'GAME01' })
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(20)
  project_code!: string;

  @ApiProperty({ description: '프로젝트명', example: '게임 프로젝트 A' })
  @IsString()
  @MaxLength(100)
  project_name!: string;

  @ApiPropertyOptional({ description: '설명', example: '모바일 RPG' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
