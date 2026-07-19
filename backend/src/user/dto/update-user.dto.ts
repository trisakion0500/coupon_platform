import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * PATCH /users/{user_id} 요청 바디. 12_USER_API.md 1.6의 Updatable Fields만 받는다
 * (user_id/company_id/requested_project_id/login_id는 DTO에 아예 없어 수정 대상이 될 수 없다).
 *
 * @author trisakion
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  user_name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1, 2, 3])
  status?: number;
}
