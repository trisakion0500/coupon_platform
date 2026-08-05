import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';

jest.mock('ioredis');

const RedisMock = Redis as jest.MockedClass<typeof Redis>;

function buildConfigService(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in values)) {
        throw new Error(`unexpected config key requested: ${key}`);
      }
      return values[key];
    }),
  } as unknown as ConfigService;
}

describe('RedisService', () => {
  beforeEach(() => {
    RedisMock.mockClear();
  });

  describe('REDIS_ENABLED=false', () => {
    let service: RedisService;

    beforeEach(() => {
      service = new RedisService(buildConfigService({ REDIS_ENABLED: false }));
      service.onModuleInit();
    });

    it('does not construct a Redis client', () => {
      expect(RedisMock).not.toHaveBeenCalled();
      expect(service.isEnabled).toBe(false);
    });

    it('setNx throws — callers must check isEnabled first', async () => {
      await expect(service.setNx('k', 10)).rejects.toThrow(
        'RedisService.setNx called while Redis is disabled',
      );
    });

    it('onModuleDestroy is a no-op', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  describe('REDIS_ENABLED=true', () => {
    let service: RedisService;
    let clientInstance: {
      set: jest.Mock;
      on: jest.Mock;
      quit: jest.Mock;
    };

    beforeEach(() => {
      service = new RedisService(
        buildConfigService({
          REDIS_ENABLED: true,
          REDIS_HOST: '127.0.0.1',
          REDIS_PORT: 6380,
          REDIS_PASSWORD: 'secret',
          REDIS_KEY_PREFIX: 'cp:',
        }),
      );
      service.onModuleInit();
      clientInstance = RedisMock.mock
        .instances[0] as unknown as typeof clientInstance;
    });

    it('constructs the Redis client with the configured options', () => {
      expect(RedisMock).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '127.0.0.1',
          port: 6380,
          password: 'secret',
          keyPrefix: 'cp:',
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
        }),
      );
      expect(service.isEnabled).toBe(true);
      expect(clientInstance.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
    });

    it('setNx returns true when SET NX succeeds (fresh nonce)', async () => {
      clientInstance.set.mockResolvedValueOnce('OK');

      await expect(service.setNx('nonce:1:abc', 300)).resolves.toBe(true);
      expect(clientInstance.set).toHaveBeenCalledWith(
        'nonce:1:abc',
        '1',
        'EX',
        300,
        'NX',
      );
    });

    it('setNx returns false when the key already exists (replay)', async () => {
      clientInstance.set.mockResolvedValueOnce(null);

      await expect(service.setNx('nonce:1:abc', 300)).resolves.toBe(false);
    });

    it('setNx propagates errors so the caller can decide to fall back', async () => {
      clientInstance.set.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(service.setNx('nonce:1:abc', 300)).rejects.toThrow(
        'ECONNREFUSED',
      );
    });

    it('onModuleDestroy quits the client', async () => {
      await service.onModuleDestroy();
      expect(clientInstance.quit).toHaveBeenCalled();
    });

    it('onModuleDestroy absorbs a quit() failure instead of rejecting', async () => {
      clientInstance.quit.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });
});
