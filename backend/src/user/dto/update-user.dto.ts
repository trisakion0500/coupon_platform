import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * PATCH /users/{user_id} 요청 바디. 14_USER_API.md 1.6의 Updatable Fields만 받는다
 * (user_id/company_id/requested_project_id/login_id는 DTO에 아예 없어 수정 대상이 될 수 없다).
 *
 * @author trisakion
 */
export class UpdateUserDto {
  @ApiPropertyOptional({ description: '사용자 이름', example: '홍길동' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  user_name?: string;

  @ApiPropertyOptional({ description: '이메일', example: 'user01@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({ description: '휴대폰번호', example: '010-1234-5678' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone_number?: string;

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

  @ApiPropertyOptional({
    description: '상태(0:가입승인대기/1:가입승인/2:가입반려/3:사용중지)',
    enum: [0, 1, 2, 3],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1, 2, 3])
  status?: number;
}
