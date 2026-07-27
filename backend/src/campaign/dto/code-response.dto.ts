import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class IssuedCouponCodeDto {
  @ApiProperty({ description: '코드 ID', example: 5001 })
  coupon_code_id!: number;

  @ApiProperty({ description: '코드 값', example: 'SUMMER2026' })
  code_value!: string;

  @ApiProperty({ description: '코드 상태(0:중지/1:사용중)', enum: [0, 1] })
  status!: number;
}

/**
 * POST /campaigns/{id}/codes 응답. 19_CAMPAIGN_API.md 3.1 — FIXED(동기, 200)만
 * `coupon_code`가 채워지고, RANDOM(비동기 시작, 202)은 `coupon_code`가 없다.
 *
 * @author trisakion
 */
export class IssueCodesResultDto {
  @ApiProperty({ description: '캠페인 ID', example: 100 })
  coupon_campaign_id!: number;

  @ApiProperty({
    description: '발급상태(1:대기/2:진행중/3:완료/4:실패)',
    enum: [1, 2, 3, 4],
  })
  generation_status!: number;

  @ApiPropertyOptional({ description: '발급된 수량(FIXED만)', example: 1 })
  generated_qty?: number;

  @ApiPropertyOptional({
    description: '발급된 코드(FIXED만)',
    type: IssuedCouponCodeDto,
  })
  coupon_code?: IssuedCouponCodeDto;
}

/** POST /campaigns/{id}/codes/retry 응답. 19_CAMPAIGN_API.md 3.2. */
export class RetryCodesResultDto {
  @ApiProperty({ description: '캠페인 ID', example: 100 })
  coupon_campaign_id!: number;

  @ApiProperty({
    description: '발급상태(재시도 시작 시 2:진행중)',
    enum: [1, 2, 3, 4],
  })
  generation_status!: number;
}

/** GET /campaigns/{id}/codes 목록 항목. status: 0=중지, 1=미사용(RANDOM)/사용중(FIXED), 2=사용완료(RANDOM). */
export class CodeListItemDto {
  @ApiProperty({ description: '코드 ID', example: 5001 })
  coupon_code_id!: number;

  @ApiProperty({ description: '코드 값', example: '23A4-B7C9-DEF2' })
  code_value!: string;

  @ApiProperty({
    description: '코드 상태(0:중지/1:미사용·사용중/2:사용완료)',
    enum: [0, 1, 2],
  })
  status!: number;

  @ApiProperty({ description: '생성일시', example: '2026-07-01 09:00:00' })
  created_at!: string;
}

/** POST /campaigns/{id}/codes/abort 응답. 19_CAMPAIGN_API.md 3.4. */
export class AbortCodeGenerationResultDto {
  @ApiProperty({ description: '캠페인 ID', example: 100 })
  coupon_campaign_id!: number;

  @ApiProperty({
    description: '중단 처리 후 발급상태(RANDOM은 4:실패, FIXED는 1:대기)',
    enum: [1, 4],
  })
  generation_status!: number;
}
