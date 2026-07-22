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
   * RANDOM/FIXED 공통 필수(2026-07-22부터 — 이전엔 FIXED를 서버가 항상 1로 강제했으나, S2S
   * reserve 스모크 테스트에서 그 강제 때문에 FIXED 캠페인이 전체 통틀어 딱 1번만 소모 가능한
   * 문제가 발견돼 제거함). RANDOM은 발급할 코드 개수, FIXED는 단일 공유 코드가 지원할 총
   * 사용가능 횟수를 의미한다(SP_CAMPAIGN_CREATE 수정1 참고).
   */
  @IsInt()
  @Min(1)
  requested_qty!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  use_limit_per_user?: number;

  @IsObject()
  reward_data!: Record<string, unknown>;
}
