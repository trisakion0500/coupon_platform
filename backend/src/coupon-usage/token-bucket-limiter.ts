interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * 07_AUTH_SECURITY.md 2.8: 프레임워크 독립적인 순수 토큰 버킷 구현 — 키별 버킷을 인메모리
 * Map에 두고, consume 호출 시점에 경과시간만큼만 토큰을 채워넣는 지연 계산(lazy refill)
 * 방식이라 별도 타이머 없이 동작한다. 고정 윈도우(express-rate-limit) 대비 장점: 윈도우
 * 경계에서 두 윈도우의 최대치가 거의 동시에 겹쳐 순간 2배 버스트가 나는 문제가 구조적으로
 * 없다 — 버킷 용량(capacity)이 항상 그 시점의 절대 상한이기 때문.
 *
 * @author trisakion
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  /**
   * @param capacity - 버킷 최대 용량(순간 허용 가능한 최대 버스트 요청 수)
   * @param refillPerSec - 초당 채워지는 토큰 수(정상상태에서 허용되는 평균 처리율)
   * @param now - 테스트에서 시간을 제어하기 위한 시계 함수(기본 `Date.now`)
   */
  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * 토큰 1개를 소비 시도한다. Map 조회~반영이 동기 코드 안에서 끝나 같은 프로세스 내
   * 요청끼리는 await 경계로 인한 레이스가 없다(Node 이벤트 루프 특성상 안전).
   *
   * @param key - 버킷을 구분하는 키(이 도메인에서는 프로젝트 API Key)
   */
  tryConsume(key: string): { allowed: boolean; retryAfterSec: number } {
    const nowMs = this.now();
    const bucket = this.buckets.get(key) ?? {
      tokens: this.capacity,
      lastRefillMs: nowMs,
    };

    const elapsedSec = Math.max(0, (nowMs - bucket.lastRefillMs) / 1000);
    const refilled = Math.min(
      this.capacity,
      bucket.tokens + elapsedSec * this.refillPerSec,
    );

    if (refilled >= 1) {
      bucket.tokens = refilled - 1;
      bucket.lastRefillMs = nowMs;
      this.buckets.set(key, bucket);
      return { allowed: true, retryAfterSec: 0 };
    }

    bucket.tokens = refilled;
    bucket.lastRefillMs = nowMs;
    this.buckets.set(key, bucket);
    const deficit = 1 - refilled;
    return {
      allowed: false,
      retryAfterSec: Math.ceil(deficit / this.refillPerSec),
    };
  }
}
