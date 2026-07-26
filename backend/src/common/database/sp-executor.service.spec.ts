import { ConfigService } from '@nestjs/config';
import { ResultCode } from '../response/result-code.enum';
import { SpExecutorService } from './sp-executor.service';

const queryMock = jest.fn();
const endMock = jest.fn();
const getConnectionMock = jest.fn();

jest.mock('mysql2/promise', () => ({
  __esModule: true,
  default: {
    createPool: jest.fn(() => ({
      query: queryMock,
      end: endMock,
      getConnection: getConnectionMock,
    })),
  },
}));

function buildConfigService(): ConfigService {
  const values: Record<string, unknown> = {
    DB_HOST: 'localhost',
    DB_PORT: 3306,
    DB_USER: 'test',
    DB_PASSWORD: 'test',
    DB_NAME: 'test',
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('SpExecutorService', () => {
  let service: SpExecutorService;

  beforeEach(() => {
    queryMock.mockReset();
    endMock.mockReset();
    getConnectionMock.mockReset();
    service = new SpExecutorService(buildConfigService());
  });

  it('returns the second result set as data when RESULT=0', async () => {
    queryMock.mockResolvedValueOnce([[[{ RESULT: 0 }], [{ project_id: 1 }]]]);

    const result = await service.callProcedure('SP_TEST', []);

    expect(result).toEqual({ result: 0, data: [{ project_id: 1 }] });
  });

  it('does not read a second result set on business failure (RESULT != 0)', async () => {
    queryMock.mockResolvedValueOnce([[[{ RESULT: 31002 }]]]);

    const result = await service.callProcedure('SP_TEST', []);

    expect(result).toEqual({ result: 31002 });
  });

  it('logs diagnostics and throws BusinessException(DATABASE_ERROR) without exposing them in the HTTP response body', async () => {
    queryMock.mockResolvedValueOnce([
      [
        [
          {
            RESULT: 50001,
            SQL_STATE: '45000',
            ERROR_NO: 1644,
            ERROR_MESSAGE: 'boom',
          },
        ],
      ],
    ]);

    let caught: unknown;
    try {
      await service.callProcedure('SP_TEST', []);
    } catch (err) {
      caught = err;
    }

    expect(caught).toMatchObject({
      resultCode: ResultCode.DATABASE_ERROR,
      // sqlDiagnostics는 CampaignCodeService의 재시도 가능 여부 판단처럼 극히 드문 내부 호출부만
      // 읽는 필드다(business.exception.ts 참고) — 어떤 경우에도 HTTP 응답 바디에는 포함되지
      // 않으므로 getResponse()로 별도 확인한다.
      sqlDiagnostics: { sqlState: '45000', errorNo: 1644 },
    });
    expect(
      (caught as { getResponse: () => unknown }).getResponse(),
    ).not.toHaveProperty('sqlDiagnostics');
  });

  it('throws when the first result set has no RESULT column', async () => {
    queryMock.mockResolvedValueOnce([[[{ NOT_RESULT: 1 }]]]);

    await expect(service.callProcedure('SP_TEST', [])).rejects.toThrow(
      /RESULT SELECT convention violated/,
    );
  });

  it('closes the pool on module destroy', async () => {
    await service.onModuleDestroy();
    expect(endMock).toHaveBeenCalled();
  });

  describe('runExclusive', () => {
    it('acquires the lock, runs fn, releases the lock and the connection', async () => {
      const connQuery = jest
        .fn()
        .mockResolvedValueOnce([[[{ RESULT: 0 }], [{ acquired: 1 }]]]) // CALL SP_LOCK_ACQUIRE
        .mockResolvedValueOnce([[[{ RESULT: 0 }], [{ released: 1 }]]]); // CALL SP_LOCK_RELEASE
      const release = jest.fn();
      getConnectionMock.mockResolvedValueOnce({ query: connQuery, release });
      const fn = jest.fn().mockResolvedValue(undefined);

      const ran = await service.runExclusive('test_lock', fn);

      expect(ran).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(connQuery).toHaveBeenNthCalledWith(1, 'CALL SP_LOCK_ACQUIRE(?)', [
        'test_lock',
      ]);
      expect(connQuery).toHaveBeenNthCalledWith(2, 'CALL SP_LOCK_RELEASE(?)', [
        'test_lock',
      ]);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('returns false without running fn when another instance already holds the lock', async () => {
      const connQuery = jest
        .fn()
        .mockResolvedValueOnce([[[{ RESULT: 0 }], [{ acquired: 0 }]]]);
      const release = jest.fn();
      getConnectionMock.mockResolvedValueOnce({ query: connQuery, release });
      const fn = jest.fn();

      const ran = await service.runExclusive('test_lock', fn);

      expect(ran).toBe(false);
      expect(fn).not.toHaveBeenCalled();
      expect(connQuery).toHaveBeenCalledTimes(1); // SP_LOCK_ACQUIRE만 — SP_LOCK_RELEASE는 호출하지 않음
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('releases the lock and the connection even if fn throws', async () => {
      const connQuery = jest
        .fn()
        .mockResolvedValueOnce([[[{ RESULT: 0 }], [{ acquired: 1 }]]])
        .mockResolvedValueOnce([[[{ RESULT: 0 }], [{ released: 1 }]]]);
      const release = jest.fn();
      getConnectionMock.mockResolvedValueOnce({ query: connQuery, release });
      const fn = jest.fn().mockRejectedValue(new Error('boom'));

      await expect(service.runExclusive('test_lock', fn)).rejects.toThrow(
        'boom',
      );
      expect(connQuery).toHaveBeenNthCalledWith(2, 'CALL SP_LOCK_RELEASE(?)', [
        'test_lock',
      ]);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('treats an unexpected SP_LOCK_ACQUIRE RESULT (system error) as not acquired, without throwing', async () => {
      const connQuery = jest
        .fn()
        .mockResolvedValueOnce([[[{ RESULT: 50001 }]]]);
      const release = jest.fn();
      getConnectionMock.mockResolvedValueOnce({ query: connQuery, release });
      const fn = jest.fn();

      const ran = await service.runExclusive('test_lock', fn);

      expect(ran).toBe(false);
      expect(fn).not.toHaveBeenCalled();
      expect(release).toHaveBeenCalledTimes(1);
    });
  });
});
