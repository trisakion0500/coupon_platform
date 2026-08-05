import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import { SessionCacheService } from './session-cache.service';

function buildConfigService(): ConfigService {
  const values: Record<string, number> = {
    SESSION_CACHE_TTL_SEC: 60,
    SESSION_CACHE_GENERATION_TTL_SEC: 120,
  };
  return {
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('SessionCacheService', () => {
  let redis: jest.Mocked<
    Pick<RedisService, 'get' | 'set' | 'del' | 'incrWithExpire'>
  > & { isEnabled: boolean };
  let service: SessionCacheService;

  beforeEach(() => {
    redis = {
      isEnabled: true,
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      incrWithExpire: jest.fn(),
    };
    service = new SessionCacheService(
      redis as unknown as RedisService,
      buildConfigService(),
    );
  });

  describe('REDIS_ENABLED=false', () => {
    beforeEach(() => {
      redis.isEnabled = false;
    });

    it('getCachedSession always misses without touching Redis', async () => {
      await expect(service.getCachedSession('jti-1')).resolves.toBeNull();
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('cacheSession/evictJti/invalidateUser are no-ops', async () => {
      await service.cacheSession('jti-1', 1, 1);
      await service.evictJti('jti-1');
      await service.invalidateUser(1);
      expect(redis.set).not.toHaveBeenCalled();
      expect(redis.del).not.toHaveBeenCalled();
      expect(redis.incrWithExpire).not.toHaveBeenCalled();
    });
  });

  describe('getCachedSession', () => {
    it('returns null on a plain miss (no cached entry)', async () => {
      redis.get.mockResolvedValueOnce(null);
      await expect(service.getCachedSession('jti-1')).resolves.toBeNull();
    });

    it('returns the session when cached generation matches current generation', async () => {
      redis.get
        .mockResolvedValueOnce(
          JSON.stringify({ userId: 1, companyId: 2, generation: 0 }),
        )
        .mockResolvedValueOnce(null); // session-gen:1 missing -> defaults to 0

      await expect(service.getCachedSession('jti-1')).resolves.toEqual({
        userId: 1,
        companyId: 2,
      });
    });

    it('returns null when the cached generation is stale (invalidated since caching)', async () => {
      redis.get
        .mockResolvedValueOnce(
          JSON.stringify({ userId: 1, companyId: 2, generation: 0 }),
        )
        .mockResolvedValueOnce('1'); // current generation bumped to 1

      await expect(service.getCachedSession('jti-1')).resolves.toBeNull();
    });

    it('returns null (not throw) when Redis errors', async () => {
      redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.getCachedSession('jti-1')).resolves.toBeNull();
    });
  });

  describe('cacheSession', () => {
    it('reads the current generation and writes it alongside the session (no race)', async () => {
      // 1번째 get: write 전 generation, 2번째 get: write 직후 재확인 — 둘 다 같은 값이면
      // 레이스가 없었다는 뜻이라 그대로 둔다.
      redis.get.mockResolvedValueOnce('3').mockResolvedValueOnce('3');

      await service.cacheSession('jti-1', 1, 2);

      expect(redis.set).toHaveBeenCalledWith(
        'session:jti-1',
        JSON.stringify({ userId: 1, companyId: 2, generation: 3 }),
        60,
      );
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('deletes the just-written entry if generation changed during the write (race mitigation)', async () => {
      // DB 검증 성공 ~ 캐시 write 사이에 동시 무효화(로그아웃 등)가 끼어들어 generation이
      // 3(write 전)에서 4(write 직후 재확인)로 바뀐 경우 — 방금 쓴 값을 즉시 지운다.
      redis.get.mockResolvedValueOnce('3').mockResolvedValueOnce('4');

      await service.cacheSession('jti-1', 1, 2);

      expect(redis.set).toHaveBeenCalledWith(
        'session:jti-1',
        JSON.stringify({ userId: 1, companyId: 2, generation: 3 }),
        60,
      );
      expect(redis.del).toHaveBeenCalledWith('session:jti-1');
    });

    it('swallows Redis errors (best-effort write)', async () => {
      redis.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(
        service.cacheSession('jti-1', 1, 2),
      ).resolves.toBeUndefined();
    });
  });

  describe('evictJti', () => {
    it('deletes the exact session key', async () => {
      await service.evictJti('jti-1');
      expect(redis.del).toHaveBeenCalledWith('session:jti-1');
    });

    it('swallows Redis errors', async () => {
      redis.del.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.evictJti('jti-1')).resolves.toBeUndefined();
    });
  });

  describe('invalidateUser', () => {
    it('bumps the generation counter with the configured TTL', async () => {
      redis.incrWithExpire.mockResolvedValueOnce(1);
      await service.invalidateUser(42);
      expect(redis.incrWithExpire).toHaveBeenCalledWith('session-gen:42', 120);
    });

    it('swallows Redis errors (logged, not thrown)', async () => {
      redis.incrWithExpire.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.invalidateUser(42)).resolves.toBeUndefined();
    });
  });
});
