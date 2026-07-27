import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 캠페인 응답 셰이프(생성/상세/수정/상태변경/승인/반려 공통, coupon_campaign 전체 컬럼).
 * 19_CAMPAIGN_API.md.
 *
 * @author trisakion
 */
export class CampaignResponseDto {
  @ApiProperty({ description: '캠페인 ID', example: 100 })
  coupon_campaign_id!: number;

  @ApiProperty({ description: '소속 프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiProperty({ description: '캠페인명', example: '여름 이벤트' })
  name!: string;

  @ApiProperty({ description: '사용 시작일시', example: '2026-08-01 00:00:00' })
  campaign_start!: string;

  @ApiProperty({ description: '사용 종료일시', example: '2026-08-31 23:59:59' })
  campaign_end!: string;

  @ApiProperty({
    description: '코드 발급 방식(1:RANDOM/2:FIXED)',
    enum: [1, 2],
  })
  code_type!: number;

  @ApiProperty({
    description: '코드에 하이픈 포함 여부(0:미포함/1:포함)',
    enum: [0, 1],
  })
  use_hyphen!: number;

  @ApiProperty({ description: '요청 수량', example: 100 })
  requested_qty!: number;

  @ApiProperty({ description: '발급된 수량', example: 100 })
  generated_qty!: number;

  @ApiProperty({
    description: '발급상태(1:대기/2:진행중/3:완료/4:실패)',
    enum: [1, 2, 3, 4],
  })
  generation_status!: number;

  @ApiPropertyOptional({
    description: '발급 실패 사유',
    example: null,
    nullable: true,
  })
  generation_error!: string | null;

  @ApiProperty({ description: '사용 가능 수량', example: 100 })
  usable_qty!: number;

  @ApiProperty({ description: '사용된 수량', example: 12 })
  used_qty!: number;

  @ApiProperty({ description: '유저당 사용 한도', example: 1 })
  use_limit_per_user!: number;

  @ApiProperty({
    description: '상태(1:대기/2:활성/3:일시중지/4:종료)',
    enum: [1, 2, 3, 4],
  })
  status!: number;

  @ApiProperty({
    description: '승인상태(1:승인불요/2:승인대기/3:승인완료/4:반려)',
    enum: [1, 2, 3, 4],
  })
  approval_status!: number;

  @ApiPropertyOptional({
    description: '승인자 사용자 ID',
    example: 2,
    nullable: true,
  })
  approved_by!: number | null;

  @ApiPropertyOptional({
    description: '승인일시',
    example: '2026-07-26 10:00:00',
    nullable: true,
  })
  approved_at!: string | null;

  @ApiPropertyOptional({
    description: '반려 사유',
    example: null,
    nullable: true,
  })
  reject_reason!: string | null;

  @ApiProperty({
    description: '보상 내용(쿠폰서버는 해석하지 않고 그대로 저장)',
    example: { item_id: 1001, item_amount: 100 },
  })
  reward_data!: Record<string, unknown>;

  @ApiPropertyOptional({
    description: '생성한 사용자 ID(SYSTEM 배치 처리 시 null 아닌 0)',
    example: 3,
    nullable: true,
  })
  created_by!: number | null;

  @ApiPropertyOptional({
    description: '마지막으로 수정한 사용자 ID',
    example: 3,
    nullable: true,
  })
  updated_by!: number | null;

  @ApiProperty({ description: '생성일시', example: '2026-07-01 09:00:00' })
  created_at!: string;

  @ApiProperty({ description: '수정일시', example: '2026-07-01 09:00:00' })
  updated_at!: string;

  @ApiProperty({
    description:
      '낙관적 동시성 제어 토큰 — PATCH/상태변경/승인/반려 요청 시 그대로 되돌려 보낸다',
    example: 0,
  })
  edit_count!: number;
}

/** GET /campaigns 목록 항목 — 상세보다 축약된 컬럼 집합. */
export class CampaignListItemDto {
  @ApiProperty({ description: '캠페인 ID', example: 100 })
  coupon_campaign_id!: number;

  @ApiProperty({ description: '소속 프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiProperty({ description: '캠페인명', example: '여름 이벤트' })
  name!: string;

  @ApiProperty({
    description: '코드 발급 방식(1:RANDOM/2:FIXED)',
    enum: [1, 2],
  })
  code_type!: number;

  @ApiProperty({ description: '요청 수량', example: 100 })
  requested_qty!: number;

  @ApiProperty({ description: '발급된 수량', example: 100 })
  generated_qty!: number;

  @ApiProperty({
    description: '발급상태(1:대기/2:진행중/3:완료/4:실패)',
    enum: [1, 2, 3, 4],
  })
  generation_status!: number;

  @ApiProperty({ description: '사용 가능 수량', example: 100 })
  usable_qty!: number;

  @ApiProperty({ description: '사용된 수량', example: 12 })
  used_qty!: number;

  @ApiProperty({
    description: '상태(1:대기/2:활성/3:일시중지/4:종료)',
    enum: [1, 2, 3, 4],
  })
  status!: number;

  @ApiProperty({
    description: '승인상태(1:승인불요/2:승인대기/3:승인완료/4:반려)',
    enum: [1, 2, 3, 4],
  })
  approval_status!: number;

  @ApiProperty({ description: '사용 시작일시', example: '2026-08-01 00:00:00' })
  campaign_start!: string;

  @ApiProperty({ description: '사용 종료일시', example: '2026-08-31 23:59:59' })
  campaign_end!: string;

  @ApiProperty({ description: '생성일시', example: '2026-07-01 09:00:00' })
  created_at!: string;

  @ApiProperty({ description: '수정일시', example: '2026-07-01 09:00:00' })
  updated_at!: string;
}

/** GET /campaigns/{id}/usages 목록 항목. confirmed_at이 null이면 미컨슘. */
export class UsageListItemDto {
  @ApiProperty({ description: '사용 이력 ID', example: 5001 })
  coupon_code_usage_id!: number;

  @ApiProperty({ description: '코드 값', example: '23A4-B7C9-DEF2' })
  code_value!: string;

  @ApiProperty({ description: '게임 유저 ID', example: 'player_1001' })
  game_user_id!: string;

  @ApiPropertyOptional({
    description: '컨펌일시(미컨슘이면 null)',
    example: null,
    nullable: true,
  })
  confirmed_at!: string | null;

  @ApiProperty({
    description: '사용(reserve)일시',
    example: '2026-07-26 10:00:00',
  })
  created_at!: string;
}

/**
 * GET /campaigns/{id}/logs 목록 항목 — log_coupon_campaign 스냅샷(매 액션마다
 * coupon_campaign 전체 컬럼을 그대로 복제 저장). edit_count/generation_status/
 * generation_error/updated_by/updated_at은 이 로그 테이블에 없다.
 */
export class CampaignLogListItemDto {
  @ApiProperty({ description: '로그 ID', example: 501 })
  idx!: number;

  @ApiProperty({
    description: '작업유형(10:등록/20:수정/30:상태변경/40:승인/50:반려)',
    enum: [10, 20, 30, 40, 50],
  })
  action!: number;

  @ApiProperty({ description: '캠페인 ID', example: 100 })
  coupon_campaign_id!: number;

  @ApiProperty({ description: '소속 프로젝트 ID', example: 1 })
  project_id!: number;

  @ApiProperty({ description: '캠페인명', example: '여름 이벤트' })
  name!: string;

  @ApiProperty({ description: '사용 시작일시', example: '2026-08-01 00:00:00' })
  campaign_start!: string;

  @ApiProperty({ description: '사용 종료일시', example: '2026-08-31 23:59:59' })
  campaign_end!: string;

  @ApiProperty({
    description: '코드 발급 방식(1:RANDOM/2:FIXED)',
    enum: [1, 2],
  })
  code_type!: number;

  @ApiProperty({
    description: '코드에 하이픈 포함 여부(0:미포함/1:포함)',
    enum: [0, 1],
  })
  use_hyphen!: number;

  @ApiProperty({ description: '요청 수량', example: 100 })
  requested_qty!: number;

  @ApiProperty({ description: '발급된 수량(이 시점 기준)', example: 100 })
  generated_qty!: number;

  @ApiProperty({ description: '사용 가능 수량(이 시점 기준)', example: 100 })
  usable_qty!: number;

  @ApiProperty({ description: '사용된 수량(이 시점 기준)', example: 12 })
  used_qty!: number;

  @ApiProperty({ description: '유저당 사용 한도', example: 1 })
  use_limit_per_user!: number;

  @ApiProperty({
    description: '상태(1:대기/2:활성/3:일시중지/4:종료)',
    enum: [1, 2, 3, 4],
  })
  status!: number;

  @ApiProperty({
    description: '승인상태(1:승인불요/2:승인대기/3:승인완료/4:반려)',
    enum: [1, 2, 3, 4],
  })
  approval_status!: number;

  @ApiPropertyOptional({
    description: '승인자 사용자 ID',
    example: 2,
    nullable: true,
  })
  approved_by!: number | null;

  @ApiPropertyOptional({
    description: '승인일시',
    example: '2026-07-26 10:00:00',
    nullable: true,
  })
  approved_at!: string | null;

  @ApiPropertyOptional({
    description: '반려 사유',
    example: null,
    nullable: true,
  })
  reject_reason!: string | null;

  @ApiProperty({
    description: '보상 내용(이 시점 기준)',
    example: { item_id: 1001, item_amount: 100 },
  })
  reward_data!: Record<string, unknown>;

  @ApiProperty({
    description: '이 액션을 수행한 사용자 ID(배치가 한 액션이면 0)',
    example: 3,
  })
  created_by!: number;

  @ApiPropertyOptional({
    description: '이 액션을 수행한 사용자 이름(배치가 한 액션이면 "SYSTEM")',
    example: '홍길동',
    nullable: true,
  })
  created_by_name!: string | null;

  @ApiProperty({ description: '작업일시', example: '2026-07-26 10:00:00' })
  created_at!: string;
}
