import { ConfigService } from '@nestjs/config';
import { LogSpExecutorService } from './log-sp-executor.service';

const queryMock = jest.fn();
const endMock = jest.fn();

jest.mock('mysql2/promise', () => ({
  __esModule: true,
  default: {
    createPool: jest.fn(() => ({
      query: queryMock,
      end: endMock,
    })),
  },
}));

function buildConfigService(): ConfigService {
  const values: Record<string, unknown> = {
    LOG_DB_HOST: 'localhost',
    LOG_DB_PORT: 3306,
    LOG_DB_USER: 'test',
    LOG_DB_PASSWORD: 'test',
    LOG_DB_NAME: 'coupon_platform_log_test',
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('LogSpExecutorService', () => {
  let service: LogSpExecutorService;

  beforeEach(() => {
    queryMock.mockReset();
    endMock.mockReset();
    service = new LogSpExecutorService(buildConfigService());
  });

  describe('callProcedure', () => {
    it('parses RESULT SELECT convention the same way as the main DB executor', async () => {
      queryMock.mockResolvedValueOnce([[[{ RESULT: 0 }], [{ idx: 1 }]]]);

      const result = await service.callProcedure('SP_LOG_TEST', []);

      expect(result).toEqual({ result: 0, data: [{ idx: 1 }] });
    });
  });

  describe('logCall', () => {
    it('does not throw when the SP reports a non-zero RESULT', async () => {
      queryMock.mockResolvedValueOnce([[[{ RESULT: 50001 }]]]);

      await expect(
        service.logCall('SP_LOG_INSERT', []),
      ).resolves.toBeUndefined();
    });

    it('does not throw when the underlying call rejects (connection failure, etc.)', async () => {
      queryMock.mockRejectedValueOnce(new Error('connection refused'));

      await expect(
        service.logCall('SP_LOG_INSERT', []),
      ).resolves.toBeUndefined();
    });

    it('does not throw when the SP violates the RESULT SELECT convention', async () => {
      queryMock.mockResolvedValueOnce([[[{ NOT_RESULT: 1 }]]]);

      await expect(
        service.logCall('SP_LOG_INSERT', []),
      ).resolves.toBeUndefined();
    });
  });

  it('closes the pool on module destroy', async () => {
    await service.onModuleDestroy();
    expect(endMock).toHaveBeenCalled();
  });
});
