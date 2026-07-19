import { Transform } from 'class-transformer';
import { IsIn, IsInt, Min } from 'class-validator';

/** 08_API_COMMON.md 2.3: 허용되는 page_size 값. */
export const PAGE_SIZE_OPTIONS = [20, 30, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

/**
 * 08_API_COMMON.md 2장 페이지네이션 정책. 목록 조회 API의 쿼리 파라미터로 사용.
 *
 * @author trisakion
 */
export class PaginationQueryDto {
  /** 페이지 번호 (1부터 시작) */
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @Min(1)
  page = 1;

  /** 페이지당 항목 수 (20/30/50/100, 기본 20) */
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  @IsIn(PAGE_SIZE_OPTIONS)
  page_size: PageSize = 20;
}

/** 08_API_COMMON.md 2.4의 목록 응답 셰이프. */
export interface PaginatedResult<T> {
  page: number;
  page_size: number;
  total_count: number;
  items: T[];
}

/**
 * 조회된 페이지 데이터를 08_API_COMMON.md 2.4 응답 형식으로 감싼다.
 *
 * @param query - 요청에서 파싱된 페이지네이션 쿼리
 * @param totalCount - 조건에 맞는 전체 행 수
 * @param items - 현재 페이지의 항목 목록
 */
export function buildPaginatedResult<T>(
  query: PaginationQueryDto,
  totalCount: number,
  items: T[],
): PaginatedResult<T> {
  return {
    page: query.page,
    page_size: query.page_size,
    total_count: totalCount,
    items,
  };
}
