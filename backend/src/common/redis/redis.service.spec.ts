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

    it.each([
      ['get', () => service.get('k')],
      ['set', () => service.set('k', 'v', 10)],
      ['del', () => service.del('k')],
      ['incrWithExpire', () => service.incrWithExpire('k', 10)],
    ])(
      '%s throws — callers must check isEnabled first',
      async (_name, call) => {
        await expect(call()).rejects.toThrow('while Redis is disabled');
      },
    );

    it('onModuleDestroy is a no-op', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  describe('REDIS_ENABLED=true', () => {
    let service: RedisService;
    let multiChain: { incr: jest.Mock; expire: jest.Mock; exec: jest.Mock };
    let clientInstance: {
      get: jest.Mock;
      set: jest.Mock;
      del: jest.Mock;
      multi: jest.Mock;
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
      multiChain = { incr: jest.fn(), expire: jest.fn(), exec: jest.fn() };
      multiChain.incr.mockReturnValue(multiChain);
      multiChain.expire.mockReturnValue(multiChain);
      clientInstance.multi = jest.fn().mockReturnValue(multiChain);
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

    it('get reads a value from Redis', async () => {
      clientInstance.get.mockResolvedValueOnce('some-value');
      await expect(service.get('some-key')).resolves.toBe('some-value');
      expect(clientInstance.get).toHaveBeenCalledWith('some-key');
    });

    it('get returns null when the key is missing', async () => {
      clientInstance.get.mockResolvedValueOnce(null);
      await expect(service.get('missing-key')).resolves.toBeNull();
    });

    it('set writes a value with the given TTL', async () => {
      await service.set('some-key', 'some-value', 60);
      expect(clientInstance.set).toHaveBeenCalledWith(
        'some-key',
        'some-value',
        'EX',
        60,
      );
    });

    it('del removes a key', async () => {
      await service.del('some-key');
      expect(clientInstance.del).toHaveBeenCalledWith('some-key');
    });

    it('incrWithExpire increments and sets the TTL in one pipeline, returning the new value', async () => {
      multiChain.exec.mockResolvedValueOnce([
        [null, 3],
        [null, 1],
      ]);

      await expect(service.incrWithExpire('session-gen:1', 120)).resolves.toBe(
        3,
      );
      expect(clientInstance.multi).toHaveBeenCalled();
      expect(multiChain.incr).toHaveBeenCalledWith('session-gen:1');
      expect(multiChain.expire).toHaveBeenCalledWith('session-gen:1', 120);
    });

    it('incrWithExpire throws if the pipeline itself fails to execute', async () => {
      multiChain.exec.mockResolvedValueOnce(null);
      await expect(
        service.incrWithExpire('session-gen:1', 120),
      ).rejects.toThrow('incrWithExpire pipeline failed');
    });

    it('incrWithExpire throws the underlying command error if INCR itself failed', async () => {
      multiChain.exec.mockResolvedValueOnce([
        [new Error('WRONGTYPE'), null],
        [null, 1],
      ]);
      await expect(
        service.incrWithExpire('session-gen:1', 120),
      ).rejects.toThrow('WRONGTYPE');
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
