import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Min } from 'class-validator';

/**
 * POST /campaigns/{coupon_campaign_id}/status 요청 바디. 19_CAMPAIGN_API.md 2.5 전이표상
 * 목표 상태는 2(활성)/3(일시중지)/4(종료)뿐이다 — 1(대기)로 되돌아가는 전이는 존재하지 않는다.
 * 실제 전이 가능 여부(현재 상태·승인상태 조합)는 SP_CAMPAIGN_CHANGE_STATUS의 조건부 UPDATE가
 * 최종 검증한다.
 *
 * `edit_count`는 필수다 — 낙관적 동시성 제어 토큰(19_CAMPAIGN_API.md 2.5 Concurrency,
 * SP_CAMPAIGN_UPDATE와 동일한 원칙). 캠페인을 바꾸는 액션은 수정/승인/반려/상태변경 순서로
 * 다양하게 섞여 들어올 수 있어, 이 SP도 마지막으로 조회한 버전이 맞는지 검증해야 한다.
 *
 * @author trisakion
 */
export class ChangeCampaignStatusDto {
  @ApiProperty({
    description:
      '낙관적 동시성 제어 토큰 — GET /campaigns/{id}에서 받은 값을 그대로 전달',
    example: 0,
  })
  @IsInt()
  @Min(0)
  edit_count!: number;

  @ApiProperty({
    description: '목표 상태(2:활성/3:일시중지/4:종료)',
    enum: [2, 3, 4],
  })
  @IsIn([2, 3, 4])
  status!: number;
}
