import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/**
 * POST /campaigns/{coupon_campaign_id}/approve 요청 바디. 원래 이 엔드포인트는 바디가 없었으나,
 * 낙관적 동시성 제어 토큰(17_CAMPAIGN_API.md 2.6 Concurrency, SP_CAMPAIGN_UPDATE와 동일한 원칙)을
 * 받기 위해 `edit_count` 하나만 담는 바디를 신설했다 — 승인자가 검토한 시점의 캠페인 내용과
 * 실제 승인 시점의 내용이 다를 수 있는 문제를 이 값으로 감지한다.
 *
 * @author trisakion
 */
export class ApproveCampaignDto {
  @ApiProperty({
    description:
      '낙관적 동시성 제어 토큰 — GET /campaigns/{id}에서 받은 값을 그대로 전달',
    example: 0,
  })
  @IsInt()
  @Min(0)
  edit_count!: number;
}
