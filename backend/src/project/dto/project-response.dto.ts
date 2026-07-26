import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 프로젝트 응답 셰이프(목록/상세/수정 공통, `api_secret` 평문은 포함하지 않는다).
 * 11_PROJECT_API.md.
 *
 * @author trisakion
 */
export class ProjectResponseDto {
  @ApiProperty({ description: '프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiProperty({ description: '소속 회사 ID', example: 1 })
  company_id!: number;

  @ApiProperty({ description: '소속 회사 코드', example: 'ACME' })
  company_code!: string;

  @ApiProperty({ description: '소속 회사명', example: '에이씨엠이 게임즈' })
  company_name!: string;

  @ApiProperty({ description: '프로젝트 코드', example: 'GAME01' })
  project_code!: string;

  @ApiProperty({ description: '프로젝트명', example: '게임 프로젝트 A' })
  project_name!: string;

  @ApiProperty({
    description: 'API Key(게임서버→쿠폰서버 S2S 인증용)',
    example: 'ak_1a2b3c4d5e6f',
  })
  api_key!: string;

  @ApiPropertyOptional({
    description: '설명',
    example: '모바일 RPG',
    nullable: true,
  })
  description!: string | null;

  @ApiProperty({ description: '상태(0:중지/1:활성)', enum: [0, 1] })
  status!: number;

  @ApiPropertyOptional({
    description: 'API Secret 마지막 재발급 일시',
    example: '2026-07-01 09:00:00',
    nullable: true,
  })
  secret_rotated_at!: string | null;

  @ApiProperty({ description: '생성일시', example: '2026-07-01 09:00:00' })
  created_at!: string;

  @ApiProperty({ description: '수정일시', example: '2026-07-01 09:00:00' })
  updated_at!: string;

  @ApiProperty({
    description:
      '낙관적 동시성 제어 토큰 — PATCH/Secret 재발급 요청 시 그대로 되돌려 보낸다',
    example: 0,
  })
  edit_count!: number;
}

/** POST /projects 응답 — 생성 시에만 평문 `api_secret`이 1회 노출된다(11_PROJECT_API.md 2.1). */
export class ProjectCreateResponseDto {
  @ApiProperty({ description: '프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiProperty({ description: '소속 회사 ID', example: 1 })
  company_id!: number;

  @ApiProperty({ description: '프로젝트 코드', example: 'GAME01' })
  project_code!: string;

  @ApiProperty({ description: '프로젝트명', example: '게임 프로젝트 A' })
  project_name!: string;

  @ApiPropertyOptional({
    description: '설명',
    example: '모바일 RPG',
    nullable: true,
  })
  description!: string | null;

  @ApiProperty({ description: 'API Key', example: 'ak_1a2b3c4d5e6f' })
  api_key!: string;

  @ApiProperty({ description: '상태(0:중지/1:활성)', enum: [0, 1] })
  status!: number;

  @ApiProperty({ description: '생성일시', example: '2026-07-01 09:00:00' })
  created_at!: string;

  @ApiProperty({ description: '수정일시', example: '2026-07-01 09:00:00' })
  updated_at!: string;

  @ApiProperty({ description: '낙관적 동시성 제어 토큰', example: 0 })
  edit_count!: number;

  @ApiProperty({
    description:
      '평문 API Secret — 이 응답에만 1회 노출되며 재조회로 다시 볼 수 없다',
    example: 'sk_9f8e7d6c5b4a3210',
  })
  api_secret!: string;
}

/** GET /projects/lookup 응답(회원가입 화면 전용, 인증 불필요). */
export class ProjectLookupResponseDto {
  @ApiProperty({ description: '프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiProperty({ description: '프로젝트명', example: '게임 프로젝트 A' })
  project_name!: string;
}

/** POST /projects/{id}/api-secret/rotate 응답 — 평문 `api_secret`이 이 응답에만 1회 노출된다. */
export class ApiSecretRotateResponseDto {
  @ApiProperty({ description: '프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiProperty({
    description:
      '재발급된 평문 API Secret — 이 응답에만 1회 노출되며 재조회로 다시 볼 수 없다',
    example: 'sk_9f8e7d6c5b4a3210',
  })
  api_secret!: string;

  @ApiProperty({ description: '재발급 일시', example: '2026-07-26 10:00:00' })
  secret_rotated_at!: string;

  @ApiProperty({
    description: '낙관적 동시성 제어 토큰(증가된 값)',
    example: 1,
  })
  edit_count!: number;
}
