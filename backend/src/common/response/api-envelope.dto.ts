import { ApiProperty } from '@nestjs/swagger';

/** 08_API_COMMON.md 1.4 성공 응답 봉투의 `result` 필드만 담는다 — `data`는 `ApiEnvelopedResponse`류
 * 데코레이터가 `allOf`로 엔드포인트별 실제 타입과 합성하므로 여기 선언하지 않는다.
 *
 * @author trisakion
 */
export class ApiResponseEnvelopeDto {
  @ApiProperty({ description: '결과 코드(성공 시 0)', example: 0 })
  result!: 0;
}

/** 08_API_COMMON.md 2.4 페이지네이션 응답의 메타 필드(`items`는 데코레이터가 조합). */
export class PaginatedEnvelopeMetaDto {
  @ApiProperty({ description: '현재 페이지', example: 1 })
  page!: number;

  @ApiProperty({ description: '페이지당 항목 수', example: 20 })
  page_size!: number;

  @ApiProperty({ description: '전체 항목 수', example: 42 })
  total_count!: number;
}
