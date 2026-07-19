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
 * POST /auth/signup 요청 바디. 08_API_COMMON.md 7장 입력값 제약을 그대로 반영한다.
 *
 * @author trisakion
 */
export class SignupDto {
  @IsInt()
  company_id!: number;

  @IsInt()
  requested_project_id!: number;

  @IsString()
  @Matches(/^[A-Za-z0-9_.-]+$/)
  @MaxLength(100)
  login_id!: string;

  @IsString()
  @Length(4, 72)
  password!: string;

  @IsString()
  @MaxLength(100)
  user_name!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsString()
  @MaxLength(20)
  phone_number!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  position?: string;
}
