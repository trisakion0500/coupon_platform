import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../crypto/crypto.service';
import { SpExecutorService } from '../database/sp-executor.service';
import { RedisService } from '../redis/redis.service';
import { ResultCode } from '../response/result-code.enum';
import { S2sAuthGuard, S2sRequest } from './s2s-auth.guard';

const NOW_SEC = 1_700_000_000;

function buildRequest(
  headers: Record<string, string | undefined>,
): Partial<S2sRequest> {
  return {
    method: 'POST',
    url: '/v1/coupons/reserve',
    path: '/v1/coupons/reserve',
    rawBody: Buffer.from(''),
    header: ((name: string) => headers[name]) as S2sRequest['header'],
  };
}

function buildContext(request: Partial<S2sRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('S2sAuthGuard', () => {
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let crypto: jest.Mocked<
    Pick<CryptoService, 'decrypt' | 'hmacSha256Hex' | 'timingSafeEqualHex'>
  >;
  let configService: ConfigService;
  let redisService: jest.Mocked<Pick<RedisService, 'setNx'>> & {
    isEnabled: boolean;
  };
  let guard: S2sAuthGuard;

  const validHeaders = (): Record<string, string> => ({
    'X-API-Key': 'test-key',
    'X-API-Timestamp': String(NOW_SEC),
    'X-API-Nonce': 'nonce-1',
    'X-API-Signature': 'deadbeef',
  });

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW_SEC * 1000);

    spExecutor = { callProcedure: jest.fn() };
    crypto = {
      decrypt: jest.fn((v: string) => `plain:${v}`),
      hmacSha256Hex: jest.fn().mockReturnValue('deadbeef'),
      timingSafeEqualHex: jest.fn((a: string, b: string) => a === b),
    };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'S2S_TIMESTAMP_TOLERANCE_SEC') return 300;
        throw new Error(`unexpected config key requested: ${key}`);
      }),
    } as unknown as ConfigService;

    redisService = { isEnabled: false, setNx: jest.fn() };

    guard = new S2sAuthGuard(
      spExecutor as unknown as SpExecutorService,
      crypto as unknown as CryptoService,
      configService,
      redisService as unknown as RedisService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws 10012 when a required header is missing', async () => {
    const context = buildContext(
      buildRequest({ ...validHeaders(), 'X-API-Key': undefined }),
    );

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.S2S_MISSING_AUTH_HEADER,
    });
  });

  it('throws 10012 when the timestamp is not an integer', async () => {
    const context = buildContext(
      buildRequest({ ...validHeaders(), 'X-API-Timestamp': 'not-a-number' }),
    );

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.S2S_MISSING_AUTH_HEADER,
    });
  });

  it('throws 10013 when the timestamp is outside tolerance', async () => {
    const context = buildContext(
      buildRequest({
        ...validHeaders(),
        'X-API-Timestamp': String(NOW_SEC - 1000),
      }),
    );

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.S2S_TIMESTAMP_OUT_OF_RANGE,
    });
  });

  it('throws 10010 when the project lookup fails', async () => {
    spExecutor.callProcedure.mockResolvedValueOnce({ result: 31002 });
    const context = buildContext(buildRequest(validHeaders()));

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.S2S_INVALID_API_KEY,
    });
  });

  it('throws 10014 when the project is suspended', async () => {
    spExecutor.callProcedure.mockResolvedValueOnce({
      result: 0,
      data: [
        { project_id: 1, status: 0, api_secret: 'enc', api_secret_prev: null },
      ],
    });
    const context = buildContext(buildRequest(validHeaders()));

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.S2S_PROJECT_SUSPENDED,
    });
  });

  it('throws 10011 when the signature matches neither secret', async () => {
    spExecutor.callProcedure.mockResolvedValueOnce({
      result: 0,
      data: [
        { project_id: 1, status: 1, api_secret: 'enc', api_secret_prev: null },
      ],
    });
    crypto.timingSafeEqualHex.mockReturnValue(false);
    const context = buildContext(buildRequest(validHeaders()));

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.S2S_SIGNATURE_MISMATCH,
    });
  });

  it('throws 10015 when the nonce was already used', async () => {
    spExecutor.callProcedure
      .mockResolvedValueOnce({
        result: 0,
        data: [
          {
            project_id: 1,
            status: 1,
            api_secret: 'enc',
            api_secret_prev: null,
          },
        ],
      })
      .mockResolvedValueOnce({ result: 10015 });
    const context = buildContext(buildRequest(validHeaders()));

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.S2S_NONCE_REUSED,
    });
  });

  it('passes and attaches project identity to the request on success', async () => {
    spExecutor.callProcedure
      .mockResolvedValueOnce({
        result: 0,
        data: [
          {
            project_id: 42,
            status: 1,
            api_secret: 'enc',
            api_secret_prev: null,
            project_code: 'DEV_PROJECT',
            company_code: 'DEV_CO',
          },
        ],
      })
      .mockResolvedValueOnce({ result: 0 });

    const request = buildRequest(validHeaders());
    const context = buildContext(request);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.s2sProject).toEqual({
      projectId: 42,
      companyCode: 'DEV_CO',
      projectCode: 'DEV_PROJECT',
    });
  });

  describe('Redis nonce path (REDIS_ENABLED=true)', () => {
    const projectRow = {
      project_id: 42,
      status: 1,
      api_secret: 'enc',
      api_secret_prev: null,
      project_code: 'DEV_PROJECT',
      company_code: 'DEV_CO',
    };

    beforeEach(() => {
      redisService.isEnabled = true;
    });

    it('passes via Redis without touching the DB nonce path for a fresh nonce', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [projectRow],
      });
      redisService.setNx.mockResolvedValueOnce(true);

      const context = buildContext(buildRequest(validHeaders()));

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(redisService.setNx).toHaveBeenCalledWith(
        `nonce:${projectRow.project_id}:nonce-1`,
        300,
      );
      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(1); // project lookup only
    });

    it('rejects with 10015 when Redis reports the nonce already exists, without falling back to DB', async () => {
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [projectRow],
      });
      redisService.setNx.mockResolvedValueOnce(false);

      const context = buildContext(buildRequest(validHeaders()));

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        resultCode: ResultCode.S2S_NONCE_REUSED,
      });
      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(1); // project lookup only, no DB fallback
    });

    it('falls back to the DB nonce path when the Redis command itself fails', async () => {
      spExecutor.callProcedure
        .mockResolvedValueOnce({ result: 0, data: [projectRow] })
        .mockResolvedValueOnce({ result: 0 }); // SP_NONCE_INSERT succeeds
      redisService.setNx.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const context = buildContext(buildRequest(validHeaders()));

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(spExecutor.callProcedure).toHaveBeenCalledTimes(2);
      expect(spExecutor.callProcedure).toHaveBeenNthCalledWith(
        2,
        'SP_NONCE_INSERT',
        [projectRow.project_id, 'nonce-1'],
      );
    });
  });
});
