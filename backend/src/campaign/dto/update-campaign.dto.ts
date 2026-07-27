import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { IsAfter } from '../../common/validators/is-after.validator';

const DATETIME_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * PATCH /campaigns/{coupon_campaign_id} 요청 바디. 19_CAMPAIGN_API.md 2.4 Updatable Fields만
 * 받는다(coupon_campaign_id/project_id/code_type/use_hyphen/requested_qty/status/
 * approval_status류는 DTO에 아예 없어 수정 대상이 될 수 없다).
 *
 * campaign_start/campaign_end는 한쪽만 보내는 부분 수정이 가능해서, 이 DTO의 `@IsAfter`는
 * 둘 다 온 경우에만 비교하고(그 외엔 통과) DB의 기존 값과 조합한 최종 검증은
 * SP_CAMPAIGN_UPDATE가 담당한다.
 *
 * `edit_count`는 필수다 — 낙관적 동시성 제어 토큰으로, GET /campaigns/{id}에서 마지막으로
 * 받은 값을 그대로 되돌려 보낸다(19_CAMPAIGN_API.md 2.4 Concurrency). 서버의 현재 값과 다르면
 * 그 사이 다른 사용자가 먼저 수정했다는 뜻이라 30005로 거부된다. 처음엔 updated_at(자동 갱신
 * 컬럼)을 재사용했으나 초 단위 정밀도라 같은 초 안의 동시 수정을 놓치는 사례가 실제로 재현돼
 * 전용 정수 카운터(coupon_campaign.edit_count)로 교체했다.
 *
 * @author trisakion
 */
export class UpdateCampaignDto {
  @ApiProperty({
    description:
      '낙관적 동시성 제어 토큰 — GET /campaigns/{id}에서 받은 값을 그대로 전달',
    example: 0,
  })
  @IsInt()
  @Min(0)
  edit_count!: number;

  @ApiPropertyOptional({ description: '캠페인명', example: '여름 이벤트' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    description: '사용 시작일시',
    example: '2026-08-01 00:00:00',
  })
  @IsOptional()
  @Matches(DATETIME_FORMAT)
  campaign_start?: string;

  @ApiPropertyOptional({
    description: '사용 종료일시',
    example: '2026-08-31 23:59:59',
  })
  @IsOptional()
  @Matches(DATETIME_FORMAT)
  @IsAfter('campaign_start')
  campaign_end?: string;

  @ApiPropertyOptional({ description: '유저당 사용 한도', example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  use_limit_per_user?: number;

  @ApiPropertyOptional({
    description: '사용 가능 수량(발급된 수량 이하로만 설정 가능)',
    example: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  usable_qty?: number;

  @ApiPropertyOptional({
    description: '보상 내용(쿠폰서버는 해석하지 않고 그대로 저장)',
    example: { item_id: 1001, item_amount: 100 },
  })
  @IsOptional()
  @IsObject()
  reward_data?: Record<string, unknown>;
}
