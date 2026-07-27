/** 10_API_COMMON.md 1.4 — 모든 응답이 이 봉투로 감싸져 온다. */
export interface ApiEnvelope<T> {
  result: number;
  data: T;
}

/** 10_API_COMMON.md 1.4 — 실패 응답(성공 시 message는 보통 없음). */
export interface ApiErrorBody {
  result: number;
  message?: string;
}

/** 10_API_COMMON.md 2.4 — 목록 조회 API 공통 응답 셰이프. */
export interface PaginatedResult<T> {
  page: number;
  page_size: number;
  total_count: number;
  items: T[];
}

/** 10_API_COMMON.md 2.3 — 목록 조회 API 공통 쿼리 파라미터. */
export interface PaginationQuery {
  page?: number;
  page_size?: 20 | 30 | 50 | 100;
}
