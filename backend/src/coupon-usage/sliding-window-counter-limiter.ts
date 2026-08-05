import { Logger } from '@nestjs/common';
import type { RedisService } from '../common/redis/redis.service';

/**
 * 09_AUTH_SECURITY.md 2.8: reserve/confirm의 **유저 단위(game_user_id 기준)** 요청 제한 —
 * 프로젝트 단위 리미터(`TokenBucketLimiter`, in-memory)와 별개 레이어로, 특정 유저 한 명이
 * 같은 프로젝트의 공유 버킷을 과도하게 소진해 다른 유저까지 영향받는 상황을 막는 게 목적이다.
 *
 * 알고리즘은 **슬라이딩 윈도우 카운터**(이전+현재 윈도우 카운트를 가중평균으로 근사) — 고정
 * 윈도우(로그인 리미터가 이미 사용 중)의 "경계에서 최대 2배 버스트" 문제를 대부분 해소하면서도,
 * Redis 커맨드는 `RedisService.incrWithExpire`/`get` 프리미티브만으로 구현 가능해(Lua 스크립트
 * 불필요) 토큰버킷(프로젝트 단위)만큼 정밀하게 버스트를 제어하지는 않지만 이 유저 단위 방어선
 * 목적(2차 방어, 필수 아님)에는 충분하다고 판단했다.
 *
 * 카운트는 **거부된 시도도 포함해 항상 먼저 증가**시킨다 — 그래야 공격자가 한도 바로 아래에서
 * 무한정 버티며 정확한 카운트를 왜곡시키는 걸 막을 수 있다(표준 슬라이딩 윈도우 카운터 구현 관례).
 *
 * 유저 수만큼 키가 생기는 특성상 슬라이딩 윈도우 로그(개별 요청 타임스탬프를 전부 저장)는
 * 메모리/커맨드 비용이 과해 채택하지 않았다 — 이 알고리즘은 윈도우당 정수 카운터 1개(Redis
 * INCR)만 쓴다.
 *
 * Redis 자체가 실패하면(연결 끊김 등) 예외를 흡수하고 **fail-open**(허용)으로 처리한다 —
 * `SessionCacheService`(2단계)와 동일한 철학, 가용성 우선.
 *
 * @author trisakion
 */
export class SlidingWindowCounterLimiter {
  private readonly logger = new Logger(SlidingWindowCounterLimiter.name);

  /**
   * @param redis - Redis 프리미티브(get/incrWithExpire)만 필요한 최소 인터페이스
   * @param windowSec - 윈도우 크기(초)
   * @param maxRequests - 윈도우당(가중평균 기준) 허용 요청 수
   * @param now - 테스트에서 시간을 제어하기 위한 시계 함수(기본 `Date.now`)
   */
  constructor(
    private readonly redis: Pick<RedisService, 'get' | 'incrWithExpire'>,
    private readonly windowSec: number,
    private readonly maxRequests: number,
    private readonly now: () => number = Date.now,
  ) {}

  async tryConsume(
    key: string,
  ): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const windowMs = this.windowSec * 1000;
    const nowMs = this.now();
    const windowId = Math.floor(nowMs / windowMs);
    const elapsedMs = nowMs - windowId * windowMs;
    const elapsedFraction = elapsedMs / windowMs;

    const curKey = `usage:user:${key}:${windowId}`;
    const prevKey = `usage:user:${key}:${windowId - 1}`;

    try {
      // 다음 윈도우에서 이 값이 prevKey로 읽혀야 하므로 windowSec*2만큼 생존시킨다.
      const curCount = await this.redis.incrWithExpire(
        curKey,
        this.windowSec * 2,
      );
      const prevRaw = await this.redis.get(prevKey);
      const prevCount = prevRaw ? Number(prevRaw) : 0;

      const weighted = curCount + prevCount * (1 - elapsedFraction);

      if (weighted <= this.maxRequests) {
        return { allowed: true, retryAfterSec: 0 };
      }

      const retryAfterSec = Math.max(
        1,
        this.windowSec - Math.floor(elapsedMs / 1000),
      );
      return { allowed: false, retryAfterSec };
    } catch (err) {
      this.logger.warn(
        `sliding window counter check failed, failing open: ${(err as Error).message}`,
      );
      return { allowed: true, retryAfterSec: 0 };
    }
  }
}
