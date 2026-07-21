import { ConfigService } from '@nestjs/config';
import { ResultCode } from '../response/result-code.enum';
import { SpExecutorService } from './sp-executor.service';

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
      // sqlDiagnostics는 CampaignService의 재시도 가능 여부 판단처럼 극히 드문 내부 호출부만
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
});
