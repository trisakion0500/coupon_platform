import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches, MaxLength } from 'class-validator';

/**
 * POST /auth/login 요청 바디. 10_API_COMMON.md 7장의 `login_id`/`password` 제약을
 * `SignupDto`와 동일하게 적용한다(필드 자체의 문서화된 제약이라 로그인 요청에도 동일 적용).
 *
 * @author trisakion
 */
export class LoginDto {
  @ApiProperty({ description: '로그인 ID', example: 'user01' })
  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(100)
  login_id!: string;

  @ApiProperty({ description: '비밀번호', example: 'Passw0rd!23' })
  @IsString()
  @Length(4, 72)
  password!: string;
}
