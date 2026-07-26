import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

/**
 * PATCH /auth/password 요청 바디.
 *
 * @author trisakion
 */
export class ChangePasswordDto {
  @ApiProperty({ description: '현재 비밀번호', example: 'Passw0rd!23' })
  @IsString()
  current_password!: string;

  @ApiProperty({ description: '새 비밀번호', example: 'NewPassw0rd!45' })
  @IsString()
  @Length(4, 72)
  new_password!: string;
}
