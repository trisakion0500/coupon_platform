import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * POST /users/{user_id}/reset-password 요청 바디. 14_USER_API.md 1.7 Validation —
 * `new_password` 필수(signup.dto.ts의 password와 동일한 길이 제약을 따른다).
 *
 * @author trisakion
 */
export class ResetPasswordDto {
  @ApiProperty({
    description: '새 비밀번호(관리자 강제 초기화)',
    example: 'NewPassw0rd!45',
  })
  @IsString()
  @Length(4, 72)
  new_password!: string;
}
