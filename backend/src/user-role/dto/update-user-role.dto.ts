import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';

/**
 * PATCH /user-roles/{user_id}/{project_id} 요청 바디. 12_USER_API.md 3.3 Updatable Fields.
 * role_code=10(SUPER_ADMIN) 시도는 DTO가 아니라 SP(SP_USER_ROLE_UPDATE)가 명시적으로
 * 30003으로 거부한다 — 문서가 이 케이스를 SP/서비스 레벨의 오류 코드로 지정했기 때문에
 * 여기서 [10,20,30,40]을 전부 허용해 그 경로에 도달하게 둔다.
 *
 * @author trisakion
 */
export class UpdateUserRoleDto {
  @ApiPropertyOptional({
    description: '역할 코드(10은 SP가 30003으로 거부)',
    enum: [10, 20, 30, 40],
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([10, 20, 30, 40])
  role_code?: number;

  @ApiPropertyOptional({ description: '상태(0:중지/1:활성)', enum: [0, 1] })
  @IsOptional()
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsIn([0, 1])
  status?: number;
}
