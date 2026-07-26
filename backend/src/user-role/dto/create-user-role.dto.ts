import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt } from 'class-validator';

/**
 * POST /user-roles 요청 바디. 12_USER_API.md 3.1 Validation — role_code는 20/30/40만 허용한다
 * (10은 SUPER_ADMIN 전용 값이라 이 API의 대상이 아니다).
 *
 * @author trisakion
 */
export class CreateUserRoleDto {
  @ApiProperty({ description: '대상 사용자 ID', example: 3 })
  @IsInt()
  user_id!: number;

  @ApiProperty({ description: '배정할 프로젝트 ID', example: 1 })
  @IsInt()
  project_id!: number;

  @ApiProperty({
    description: '역할 코드(20:DEVELOPER/30:MANAGER/40:OPERATOR)',
    enum: [20, 30, 40],
  })
  @IsIn([20, 30, 40])
  role_code!: number;
}
