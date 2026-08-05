import { ConfigService } from '@nestjs/config';
import { SpExecutorService } from '../database/sp-executor.service';
import { RedisService } from '../redis/redis.service';
import { ProjectIdentityCacheService } from './project-identity-cache.service';

function buildConfigService(): ConfigService {
  return {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'PROJECT_API_KEY_CACHE_TTL_SEC') {
        return 2592000;
      }
      throw new Error(`unexpected config key requested: ${key}`);
    }),
  } as unknown as ConfigService;
}

describe('ProjectIdentityCacheService', () => {
  let redisService: jest.Mocked<Pick<RedisService, 'get' | 'set'>> & {
    isEnabled: boolean;
  };
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let service: ProjectIdentityCacheService;

  beforeEach(() => {
    redisService = {
      isEnabled: true,
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
    };
    spExecutor = { callProcedure: jest.fn() };
    service = new ProjectIdentityCacheService(
      redisService as unknown as RedisService,
      spExecutor as unknown as SpExecutorService,
      buildConfigService(),
    );
  });

  describe('resolve', () => {
    it('캐시 히트면 SP를 호출하지 않고 캐시된 값을 반환한다', async () => {
      redisService.get.mockResolvedValue(
        JSON.stringify({ projectId: 1, companyId: 2 }),
      );

      await expect(service.resolve('api-key-1')).resolves.toEqual({
        projectId: 1,
        companyId: 2,
      });
      expect(redisService.get).toHaveBeenCalledWith('project:apikey:api-key-1');
      expect(spExecutor.callProcedure).not.toHaveBeenCalled();
    });

    it('캐시 미스면 SP로 폴백해서 조회하고 결과를 캐싱한다', async () => {
      redisService.get.mockResolvedValue(null);
      spExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ project_id: 5, company_id: 9 }],
      });

      await expect(service.resolve('api-key-2')).resolves.toEqual({
        projectId: 5,
        companyId: 9,
      });
      expect(spExecutor.callProcedure).toHaveBeenCalledWith(
        'SP_PROJECT_GET_IDENTITY_BY_API_KEY',
        ['api-key-2'],
      );
      expect(redisService.set).toHaveBeenCalledWith(
        'project:apikey:api-key-2',
        JSON.stringify({ projectId: 5, companyId: 9 }),
        2592000,
      );
    });

    it('SP가 31002(존재하지 않는 api_key)를 반환하면 null이고 캐싱하지 않는다', async () => {
      redisService.get.mockResolvedValue(null);
      spExecutor.callProcedure.mockResolvedValue({ result: 31002 });

      await expect(service.resolve('unknown-key')).resolves.toBeNull();
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('SP 호출 자체가 던져도 예외를 삼키고 null을 반환한다', async () => {
      redisService.get.mockResolvedValue(null);
      spExecutor.callProcedure.mockRejectedValue(new Error('DB down'));

      await expect(service.resolve('api-key-3')).resolves.toBeNull();
    });

    it('REDIS_ENABLED=false면 캐시를 건드리지 않고 바로 SP로 조회한다', async () => {
      redisService.isEnabled = false;
      spExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ project_id: 7, company_id: 8 }],
      });

      await expect(service.resolve('api-key-4')).resolves.toEqual({
        projectId: 7,
        companyId: 8,
      });
      expect(redisService.get).not.toHaveBeenCalled();
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('캐시 읽기가 실패해도 SP 폴백으로 안전하게 이어간다', async () => {
      redisService.get.mockRejectedValue(new Error('ECONNRESET'));
      spExecutor.callProcedure.mockResolvedValue({
        result: 0,
        data: [{ project_id: 1, company_id: 1 }],
      });

      await expect(service.resolve('api-key-5')).resolves.toEqual({
        projectId: 1,
        companyId: 1,
      });
    });
  });

  describe('cacheIdentity', () => {
    it('write-through로 캐시에 기록한다', async () => {
      await service.cacheIdentity('api-key-6', 10, 20);

      expect(redisService.set).toHaveBeenCalledWith(
        'project:apikey:api-key-6',
        JSON.stringify({ projectId: 10, companyId: 20 }),
        2592000,
      );
    });

    it('REDIS_ENABLED=false면 아무것도 하지 않는다', async () => {
      redisService.isEnabled = false;

      await service.cacheIdentity('api-key-7', 1, 1);

      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('쓰기 실패해도 예외를 던지지 않는다', async () => {
      redisService.set.mockRejectedValue(new Error('ECONNRESET'));

      await expect(
        service.cacheIdentity('api-key-8', 1, 1),
      ).resolves.toBeUndefined();
    });
  });
});
