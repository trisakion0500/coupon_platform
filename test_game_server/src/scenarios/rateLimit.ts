/** 08_API_COMMON.md — 프로젝트 단위 토큰버킷 요청제한 초과. */
export const RATE_LIMIT_EXCEEDED_RESULT_CODE = 40001;

/**
 * `TICK_INTERVAL_MS`를 공격적으로 낮춰 돌리면(예: 50ms) 프로젝트 토큰버킷이 실제로 고갈돼
 * 40001이 섞여 들어올 수 있다 — 이건 각 시나리오가 검증하려는 비즈니스 로직과 무관한 외부
 * 스로틀링이므로, 시나리오들이 이 코드를 만나면 "기대와 다른 결과"(진짜 mismatch)로 잘못
 * 분류하지 않고 건너뛰도록 이 헬퍼로 공용 판별한다.
 */
export function isRateLimited(resultCode: number): boolean {
  return resultCode === RATE_LIMIT_EXCEEDED_RESULT_CODE;
}
