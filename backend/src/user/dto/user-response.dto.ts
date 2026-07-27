import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 사용자 응답 공통 셰이프 — `AuthService.toUserResponse`(11_AUTH_API.md 회원가입/내정보)와
 * `UserService.toUserResponse`(14_USER_API.md 1장)가 필드 구성이 완전히 동일해 이 클래스
 * 하나를 공유한다. `password_hash`는 항상 제외, `phone_number`는 복호화된 평문.
 *
 * @author trisakion
 */
export class UserResponseDto {
  @ApiProperty({ description: '사용자 ID', example: 3 })
  user_id!: number;

  @ApiProperty({ description: '소속 회사 ID', example: 1 })
  company_id!: number;

  @ApiPropertyOptional({
    description: '회원가입 시점의 희망 프로젝트 ID',
    example: 1,
    nullable: true,
  })
  requested_project_id!: number | null;

  @ApiProperty({ description: '로그인 ID', example: 'user01' })
  login_id!: string;

  @ApiProperty({ description: '사용자 이름', example: '홍길동' })
  user_name!: string;

  @ApiProperty({ description: '이메일', example: 'user01@example.com' })
  email!: string;

  @ApiProperty({ description: '휴대폰번호', example: '010-1234-5678' })
  phone_number!: string;

  @ApiPropertyOptional({
    description: '부서',
    example: '운영팀',
    nullable: true,
  })
  department!: string | null;

  @ApiPropertyOptional({ description: '직급', example: '대리', nullable: true })
  position!: string | null;

  @ApiProperty({
    description: '상태(0:가입승인대기/1:가입승인/2:가입반려/3:사용중지)',
    enum: [0, 1, 2, 3],
  })
  status!: number;

  @ApiPropertyOptional({
    description: '최근 로그인 일시',
    example: '2026-07-26 10:00:00',
    nullable: true,
  })
  last_login_at!: string | null;

  @ApiProperty({ description: '생성일시', example: '2026-07-01 09:00:00' })
  created_at!: string;

  @ApiProperty({ description: '수정일시', example: '2026-07-01 09:00:00' })
  updated_at!: string;
}
