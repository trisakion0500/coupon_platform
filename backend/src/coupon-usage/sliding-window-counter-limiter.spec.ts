import type { RedisService } from '../common/redis/redis.service';
import { SlidingWindowCounterLimiter } from './sliding-window-counter-limiter';

/** 인메모리 카운터로 RedisService의 get/incrWithExpire를 흉내내는 테스트 더블. */
function buildFakeRedis(): Pick<RedisService, 'get' | 'incrWithExpire'> & {
  store: Map<string, number>;
} {
  const store = new Map<string, number>();
  return {
    store,
    get: jest.fn((key: string) => {
      const value = store.get(key);
      return Promise.resolve(value === undefined ? null : String(value));
    }),
    incrWithExpire: jest.fn((key: string) => {
      const value = (store.get(key) ?? 0) + 1;
      store.set(key, value);
      return Promise.resolve(value);
    }),
  };
}

describe('SlidingWindowCounterLimiter', () => {
  it('한도 이내면 허용한다', async () => {
    const redis = buildFakeRedis();
    const now = 0;
    const limiter = new SlidingWindowCounterLimiter(redis, 60, 3, () => now);

    expect((await limiter.tryConsume('key')).allowed).toBe(true);
    expect((await limiter.tryConsume('key')).allowed).toBe(true);
    expect((await limiter.tryConsume('key')).allowed).toBe(true);
  });

  it('한도를 넘으면 거부하고 retryAfterSec을 반환한다', async () => {
    const redis = buildFakeRedis();
    const now = 0;
    const limiter = new SlidingWindowCounterLimiter(redis, 60, 1, () => now);

    expect((await limiter.tryConsume('key')).allowed).toBe(true);
    const rejected = await limiter.tryConsume('key');
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSec).toBeGreaterThan(0);
  });

  it('거부된 시도도 카운트에 포함된다(다음 시도도 계속 거부)', async () => {
    const redis = buildFakeRedis();
    const now = 0;
    const limiter = new SlidingWindowCounterLimiter(redis, 60, 1, () => now);

    await limiter.tryConsume('key');
    await limiter.tryConsume('key'); // 거부, 카운트는 2로 증가
    const third = await limiter.tryConsume('key');
    expect(third.allowed).toBe(false);
  });

  it('윈도우 경계를 넘어가면 이전 윈도우 카운트의 가중치가 줄어든다', async () => {
    const redis = buildFakeRedis();
    let now = 0;
    const windowSec = 60;
    const maxRequests = 5;
    const limiter = new SlidingWindowCounterLimiter(
      redis,
      windowSec,
      maxRequests,
      () => now,
    );

    // 현재 윈도우(windowId=0)를 한도까지 정확히 채운다(전부 허용).
    for (let i = 0; i < maxRequests; i++) {
      expect((await limiter.tryConsume('key')).allowed).toBe(true);
    }

    // 다음 윈도우(windowId=1) 시작 시점 — 이전 윈도우 가중치가 아직 100%라
    // (curCount=1) + (prevCount=5)*1.0 = 6 > 5 로 여전히 거부돼야 한다.
    now = windowSec * 1000;
    expect((await limiter.tryConsume('key')).allowed).toBe(false);

    // 같은 윈도우의 절반(50%) 지점 — 이전 윈도우 가중치가 절반으로 줄어
    // (curCount=2) + (prevCount=5)*0.5 = 4.5 <= 5 로 여유가 생겨야 한다.
    now = windowSec * 1000 + (windowSec * 1000) / 2;
    expect((await limiter.tryConsume('key')).allowed).toBe(true);
  });

  it('키가 다르면 카운터도 독립적이다', async () => {
    const redis = buildFakeRedis();
    const now = 0;
    const limiter = new SlidingWindowCounterLimiter(redis, 60, 1, () => now);

    expect((await limiter.tryConsume('user-a')).allowed).toBe(true);
    expect((await limiter.tryConsume('user-a')).allowed).toBe(false);
    expect((await limiter.tryConsume('user-b')).allowed).toBe(true);
  });

  it('Redis 에러 시 fail-open(허용)으로 처리한다', async () => {
    const redis: Pick<RedisService, 'get' | 'incrWithExpire'> = {
      get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      incrWithExpire: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const limiter = new SlidingWindowCounterLimiter(redis, 60, 1, () => 0);

    const result = await limiter.tryConsume('key');
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSec).toBe(0);
  });
});
