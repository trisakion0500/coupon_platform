import { IsIn, IsInt } from 'class-validator';

/**
 * POST /user-roles 요청 바디. 12_USER_API.md 3.1 Validation — role_code는 20/30/40만 허용한다
 * (10은 SUPER_ADMIN 전용 값이라 이 API의 대상이 아니다).
 *
 * @author trisakion
 */
export class CreateUserRoleDto {
  @IsInt()
  user_id!: number;

  @IsInt()
  project_id!: number;

  @IsIn([20, 30, 40])
  role_code!: number;
}
