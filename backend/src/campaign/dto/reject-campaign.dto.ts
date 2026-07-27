import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, Min } from 'class-validator';

/**
 * POST /campaigns/{coupon_campaign_id}/reject 요청 바디. 19_CAMPAIGN_API.md 2.7 Validation.
 *
 * `edit_count`는 필수다 — 낙관적 동시성 제어 토큰(19_CAMPAIGN_API.md 2.7 Concurrency,
 * SP_CAMPAIGN_UPDATE와 동일한 원칙).
 *
 * @author trisakion
 */
export class RejectCampaignDto {
  @ApiProperty({
    description:
      '낙관적 동시성 제어 토큰 — GET /campaigns/{id}에서 받은 값을 그대로 전달',
    example: 0,
  })
  @IsInt()
  @Min(0)
  edit_count!: number;

  @ApiProperty({
    description: '반려 사유',
    example: '보상 내용이 정책에 맞지 않습니다.',
  })
  @IsString()
  @MaxLength(500)
  reject_reason!: string;
}
