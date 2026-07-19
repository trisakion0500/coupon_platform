import { IsString, Length } from 'class-validator';

/**
 * PATCH /auth/password 요청 바디.
 *
 * @author trisakion
 */
export class ChangePasswordDto {
  @IsString()
  current_password!: string;

  @IsString()
  @Length(4, 72)
  new_password!: string;
}
