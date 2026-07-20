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
 * PATCH /campaigns/{coupon_campaign_id} 요청 바디. 17_CAMPAIGN_API.md 2.4 Updatable Fields만
 * 받는다(coupon_campaign_id/project_id/code_type/use_hyphen/requested_qty/status/
 * approval_status류는 DTO에 아예 없어 수정 대상이 될 수 없다).
 *
 * campaign_start/campaign_end는 한쪽만 보내는 부분 수정이 가능해서, 이 DTO의 `@IsAfter`는
 * 둘 다 온 경우에만 비교하고(그 외엔 통과) DB의 기존 값과 조합한 최종 검증은
 * SP_CAMPAIGN_UPDATE가 담당한다.
 *
 * `edit_count`는 필수다 — 낙관적 동시성 제어 토큰으로, GET /campaigns/{id}에서 마지막으로
 * 받은 값을 그대로 되돌려 보낸다(17_CAMPAIGN_API.md 2.4 Concurrency). 서버의 현재 값과 다르면
 * 그 사이 다른 사용자가 먼저 수정했다는 뜻이라 30005로 거부된다. 처음엔 updated_at(자동 갱신
 * 컬럼)을 재사용했으나 초 단위 정밀도라 같은 초 안의 동시 수정을 놓치는 사례가 실제로 재현돼
 * 전용 정수 카운터(coupon_campaign.edit_count)로 교체했다.
 *
 * @author trisakion
 */
export class UpdateCampaignDto {
  @IsInt()
  @Min(0)
  edit_count!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Matches(DATETIME_FORMAT)
  campaign_start?: string;

  @IsOptional()
  @Matches(DATETIME_FORMAT)
  @IsAfter('campaign_start')
  campaign_end?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  use_limit_per_user?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  usable_qty?: number;

  @IsOptional()
  @IsObject()
  reward_data?: Record<string, unknown>;
}
