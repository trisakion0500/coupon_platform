import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { ProjectIdentityCacheService } from '../common/project-identity-cache/project-identity-cache.service';
import { RateLimitLogService } from './rate-limit-log.service';

describe('RateLimitLogService', () => {
  let projectIdentityCache: jest.Mocked<
    Pick<ProjectIdentityCacheService, 'resolve'>
  >;
  let logSpExecutor: jest.Mocked<Pick<LogSpExecutorService, 'logCall'>>;
  let service: RateLimitLogService;

  beforeEach(() => {
    projectIdentityCache = { resolve: jest.fn() };
    logSpExecutor = { logCall: jest.fn().mockResolvedValue(undefined) };
    service = new RateLimitLogService(
      projectIdentityCache as unknown as ProjectIdentityCacheService,
      logSpExecutor as unknown as LogSpExecutorService,
    );
  });

  it('identity가 해석되면 project_id/company_id를 채워 기록한다', async () => {
    projectIdentityCache.resolve.mockResolvedValue({
      projectId: 5,
      companyId: 9,
    });

    await service.record({
      limitScope: 'PROJECT',
      action: 'RESERVE',
      apiKey: 'api-key-1',
      gameUserId: null,
      retryAfterSec: 3,
      callerIp: '127.0.0.1',
    });

    expect(projectIdentityCache.resolve).toHaveBeenCalledWith('api-key-1');
    expect(logSpExecutor.logCall).toHaveBeenCalledWith(
      'SP_LOG_COUPON_RATE_LIMIT_CREATE',
      [10, 10, 'api-key-1', 5, 9, null, 3, '127.0.0.1'],
    );
  });

  it('identity 해석이 실패하면 project_id/company_id를 NULL로 기록한다', async () => {
    projectIdentityCache.resolve.mockResolvedValue(null);

    await service.record({
      limitScope: 'USER',
      action: 'CONFIRM',
      apiKey: 'unknown-key',
      gameUserId: 'player-1',
      retryAfterSec: 7,
      callerIp: null,
    });

    expect(logSpExecutor.logCall).toHaveBeenCalledWith(
      'SP_LOG_COUPON_RATE_LIMIT_CREATE',
      [20, 20, 'unknown-key', null, null, 'player-1', 7, null],
    );
  });
});
