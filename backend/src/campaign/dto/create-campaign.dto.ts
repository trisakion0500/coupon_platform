import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { IsAfter } from '../../common/validators/is-after.validator';

/** 08_API_COMMON.md 4.1 날짜/시간 형식 — YYYY-MM-DD HH:mm:ss (ISO 8601 T구분자 아님). */
const DATETIME_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * POST /campaigns 요청 바디. 17_CAMPAIGN_API.md 2.1 Validation을 그대로 반영한다.
 *
 * @author trisakion
 */
export class CreateCampaignDto {
  @ApiProperty({ description: '소속 프로젝트 ID', example: 1 })
  @IsInt()
  project_id!: number;

  @ApiProperty({ description: '캠페인명', example: '여름 이벤트' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '사용 시작일시', example: '2026-08-01 00:00:00' })
  @Matches(DATETIME_FORMAT)
  campaign_start!: string;

  @ApiProperty({
    description: '사용 종료일시(시작일시 이후여야 함)',
    example: '2026-08-31 23:59:59',
  })
  @Matches(DATETIME_FORMAT)
  @IsAfter('campaign_start')
  campaign_end!: string;

  @ApiProperty({
    description: '코드 발급 방식(1:RANDOM/2:FIXED)',
    enum: [1, 2],
  })
  @IsIn([1, 2])
  code_type!: number;

  @ApiPropertyOptional({
    description: '코드에 하이픈 포함 여부(0:미포함/1:포함, 기본 미포함)',
    enum: [0, 1],
  })
  @IsOptional()
  @IsIn([0, 1])
  use_hyphen?: number;

  /**
   * RANDOM/FIXED 공통 필수(2026-07-22부터 — 이전엔 FIXED를 서버가 항상 1로 강제했으나, S2S
   * reserve 스모크 테스트에서 그 강제 때문에 FIXED 캠페인이 전체 통틀어 딱 1번만 소모 가능한
   * 문제가 발견돼 제거함). RANDOM은 발급할 코드 개수, FIXED는 단일 공유 코드가 지원할 총
   * 사용가능 횟수를 의미한다(SP_CAMPAIGN_CREATE 수정1 참고).
   */
  @ApiProperty({
    description:
      '요청 수량(RANDOM: 발급할 코드 개수 / FIXED: 코드 1건이 지원할 총 사용가능 횟수)',
    example: 100,
  })
  @IsInt()
  @Min(1)
  requested_qty!: number;

  @ApiPropertyOptional({
    description: '유저당 사용 한도(미지정 시 무제한)',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  use_limit_per_user?: number;

  @ApiProperty({
    description: '보상 내용(쿠폰서버는 해석하지 않고 그대로 저장)',
    example: { item_id: 1001, item_amount: 100 },
  })
  @IsObject()
  reward_data!: Record<string, unknown>;
}
