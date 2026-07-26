import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 사용자 권한배정 응답 셰이프(생성/목록/수정 공통). 12_USER_API.md 3장.
 *
 * @author trisakion
 */
export class UserRoleResponseDto {
  @ApiProperty({ description: '사용자 ID', example: 3 })
  user_id!: number;

  @ApiProperty({ description: '프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiProperty({ description: '역할 코드', enum: [10, 20, 30, 40] })
  role_code!: number;

  @ApiProperty({ description: '상태(0:중지/1:활성)', enum: [0, 1] })
  status!: number;

  @ApiProperty({ description: '생성일시', example: '2026-07-01 09:00:00' })
  created_at!: string;

  @ApiProperty({ description: '수정일시', example: '2026-07-01 09:00:00' })
  updated_at!: string;
}

/** GET /user-roles/me 응답. 11_PROJECT_API.md 3.1 — 헤더의 프로젝트 선택 시 내 role 조회.
 * 배정이 없으면 `role_code`가 `null`. */
export class MyRoleForProjectDto {
  @ApiProperty({ description: '조회한 프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiPropertyOptional({
    description: '해당 프로젝트에서의 내 역할 코드(배정 없으면 null)',
    enum: [10, 20, 30, 40],
    nullable: true,
  })
  role_code!: number | null;
}
