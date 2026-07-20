import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
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
  @IsInt()
  project_id!: number;

  @IsString()
  @MaxLength(100)
  name!: string;

  @Matches(DATETIME_FORMAT)
  campaign_start!: string;

  @Matches(DATETIME_FORMAT)
  @IsAfter('campaign_start')
  campaign_end!: string;

  @IsIn([1, 2])
  code_type!: number;

  @IsOptional()
  @IsIn([0, 1])
  use_hyphen?: number;

  /**
   * code_type=1(RANDOM)일 때만 필수(FIXED는 서버가 항상 1로 강제하므로 필수가 아니다) — 단
   * FIXED에서도 값이 오면(무시될 필드라도) 타입 검증은 그대로 통과시킨다. 그냥 `@IsOptional()`로
   * FIXED일 때 검증을 통째로 건너뛰면, 숫자가 아닌 값이 와도 DTO를 통과해 SP의
   * `INT UNSIGNED` 파라미터 바인딩에서 500(DB 오류)으로 새 나갈 수 있다(2026-07-20 리뷰에서
   * 발견) — ValidateIf 조건에 "값이 존재하는 경우"도 포함해 FIXED에서도 있는 값은 검증한다.
   */
  @ValidateIf(
    (dto: CreateCampaignDto) =>
      dto.code_type === 1 || dto.requested_qty !== undefined,
  )
  @IsInt()
  @Min(1)
  requested_qty?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  use_limit_per_user?: number;

  @IsObject()
  reward_data!: Record<string, unknown>;
}
