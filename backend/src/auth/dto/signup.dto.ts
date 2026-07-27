import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * POST /auth/signup 요청 바디. 10_API_COMMON.md 7장 입력값 제약을 그대로 반영한다.
 *
 * @author trisakion
 */
export class SignupDto {
  @ApiProperty({
    description: '가입할 회사 ID(회사 코드 lookup으로 조회)',
    example: 1,
  })
  @IsInt()
  company_id!: number;

  @ApiPropertyOptional({
    description: '희망 프로젝트 ID(선택 — 지정하지 않으면 승인자가 배정)',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  requested_project_id?: number;

  @ApiProperty({ description: '로그인 ID', example: 'user01' })
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(100)
  login_id!: string;

  @ApiProperty({ description: '비밀번호', example: 'Passw0rd!23' })
  @IsString()
  @Length(4, 72)
  password!: string;

  @ApiProperty({ description: '사용자 이름', example: '홍길동' })
  @IsString()
  @MaxLength(100)
  user_name!: string;

  @ApiProperty({ description: '이메일', example: 'user01@example.com' })
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty({ description: '휴대폰번호', example: '010-1234-5678' })
  @IsString()
  @MaxLength(20)
  phone_number!: string;

  @ApiPropertyOptional({ description: '부서', example: '운영팀' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @ApiPropertyOptional({ description: '직급', example: '대리' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;
}
