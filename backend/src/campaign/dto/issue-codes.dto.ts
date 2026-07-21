import { IsOptional, IsString, Length } from 'class-validator';

/**
 * POST /campaigns/{coupon_campaign_id}/codes 요청 바디. 17_CAMPAIGN_API.md 3.1.
 *
 * RANDOM(code_type=1)은 바디가 아예 없고, FIXED(code_type=2)만 `code_value`를 보낸다 — 이 DTO는
 * 캠페인의 `code_type`을 모르는 상태에서 검증하므로 "FIXED면 필수"까지는 강제하지 못한다(값이
 * 있으면 형식만 검증). 실제 필수 여부 재검증은 SP_CAMPAIGN_CODE_ISSUE가 캠페인의 code_type을
 * 직접 조회해 수행한다(30001).
 *
 * @author trisakion
 */
export class IssueCodesDto {
  @IsOptional()
  @IsString()
  @Length(1, 50)
  code_value?: string;
}
