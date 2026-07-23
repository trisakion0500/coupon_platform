import { TokenBucketLimiter } from './token-bucket-limiter';

describe('TokenBucketLimiter', () => {
  it('버킷 용량만큼은 즉시 연속 소비를 허용한다', () => {
    const now = 0;
    const limiter = new TokenBucketLimiter(3, 1, () => now);

    expect(limiter.tryConsume('key').allowed).toBe(true);
    expect(limiter.tryConsume('key').allowed).toBe(true);
    expect(limiter.tryConsume('key').allowed).toBe(true);
  });

  it('용량을 초과하면 거부하고 retryAfterSec을 반환한다', () => {
    const now = 0;
    const limiter = new TokenBucketLimiter(1, 1, () => now);

    expect(limiter.tryConsume('key').allowed).toBe(true);
    const rejected = limiter.tryConsume('key');
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSec).toBeGreaterThan(0);
  });

  it('시간이 지나면 refillPerSec만큼 토큰이 회복된다', () => {
    let now = 0;
    const limiter = new TokenBucketLimiter(2, 1, () => now);

    expect(limiter.tryConsume('key').allowed).toBe(true);
    expect(limiter.tryConsume('key').allowed).toBe(true);
    expect(limiter.tryConsume('key').allowed).toBe(false);

    now += 1000; // 1초 경과 → 토큰 1개 회복
    expect(limiter.tryConsume('key').allowed).toBe(true);
    expect(limiter.tryConsume('key').allowed).toBe(false);
  });

  it('회복량은 용량을 넘지 않는다(오래 쉰 뒤에도 상한은 capacity)', () => {
    let now = 0;
    const limiter = new TokenBucketLimiter(2, 5, () => now);

    limiter.tryConsume('key');
    limiter.tryConsume('key');

    now += 100_000; // 아주 오래 경과
    expect(limiter.tryConsume('key').allowed).toBe(true);
    expect(limiter.tryConsume('key').allowed).toBe(true);
    expect(limiter.tryConsume('key').allowed).toBe(false);
  });

  it('키가 다르면 버킷도 독립적이다(한 프로젝트의 소진이 다른 프로젝트에 영향 없음)', () => {
    const now = 0;
    const limiter = new TokenBucketLimiter(1, 1, () => now);

    expect(limiter.tryConsume('project-a').allowed).toBe(true);
    expect(limiter.tryConsume('project-a').allowed).toBe(false);
    expect(limiter.tryConsume('project-b').allowed).toBe(true);
  });
});
