/** 08_API_COMMON.md 6.1 GET /health 응답. */
export interface HealthCheck {
  status: string;
  /** UTC epoch ms — 헤더 실시간 시계의 서버-클라이언트 오프셋 계산용(useServerClock 참고). */
  server_time: number;
}
