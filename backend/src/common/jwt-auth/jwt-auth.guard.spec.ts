import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TokenExpiredError } from 'jsonwebtoken';
import { SpExecutorService } from '../database/sp-executor.service';
import { BusinessException } from '../response/business.exception';
import { ResultCode } from '../response/result-code.enum';
import { SessionCacheService } from '../session-cache/session-cache.service';
import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';
import { JwtPayload } from './jwt-payload.interface';

function buildContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  request: Partial<AuthenticatedRequest>;
} {
  const request: Partial<AuthenticatedRequest> = {
    header: ((name: string) => headers[name]) as AuthenticatedRequest['header'],
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('JwtAuthGuard', () => {
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;
  let spExecutor: jest.Mocked<Pick<SpExecutorService, 'callProcedure'>>;
  let sessionCache: jest.Mocked<
    Pick<SessionCacheService, 'getCachedSession' | 'cacheSession'>
  >;
  let guard: JwtAuthGuard;

  const validPayload: JwtPayload = {
    jti: 'jti-1',
    user_id: 1,
    company_id: 1,
    role_code: 10,
  };

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    spExecutor = { callProcedure: jest.fn() };
    // 기본값은 항상 미스 — 기존 DB 경로 테스트들이 캐시 계층 도입 후에도 그대로 통과해야 한다.
    sessionCache = {
      getCachedSession: jest.fn().mockResolvedValue(null),
      cacheSession: jest.fn().mockResolvedValue(undefined),
    };
    guard = new JwtAuthGuard(
      jwtService as unknown as JwtService,
      spExecutor as unknown as SpExecutorService,
      sessionCache as unknown as SessionCacheService,
    );
  });

  it('throws 10004 when the Authorization header is missing', async () => {
    const { context } = buildContext({});
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.LOGIN_REQUIRED,
    });
  });

  it('throws 10004 when the header is not a Bearer token', async () => {
    const { context } = buildContext({ Authorization: 'Basic abc123' });
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.LOGIN_REQUIRED,
    });
  });

  it('throws 10003 when the token is expired', async () => {
    jwtService.verifyAsync.mockRejectedValueOnce(
      new TokenExpiredError('jwt expired', new Date()),
    );
    const { context } = buildContext({ Authorization: 'Bearer expired-token' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.ACCESS_TOKEN_EXPIRED,
    });
  });

  it('throws 10004 when the signature is invalid', async () => {
    jwtService.verifyAsync.mockRejectedValueOnce(
      new Error('invalid signature'),
    );
    const { context } = buildContext({ Authorization: 'Bearer bad-token' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.LOGIN_REQUIRED,
    });
  });

  it('throws 10009 when the session is missing/logged out', async () => {
    jwtService.verifyAsync.mockResolvedValueOnce(validPayload);
    spExecutor.callProcedure.mockResolvedValueOnce({ result: 10009 });
    const { context } = buildContext({ Authorization: 'Bearer valid-token' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.INVALID_SESSION,
    });
  });

  it('propagates DATABASE_ERROR when SpExecutorService throws it (SP system error)', async () => {
    jwtService.verifyAsync.mockResolvedValueOnce(validPayload);
    spExecutor.callProcedure.mockRejectedValueOnce(
      new BusinessException(ResultCode.DATABASE_ERROR),
    );
    const { context } = buildContext({ Authorization: 'Bearer valid-token' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      resultCode: ResultCode.DATABASE_ERROR,
    });
  });

  it.each([
    [0, ResultCode.SIGNUP_PENDING_APPROVAL],
    [2, ResultCode.SIGNUP_REJECTED],
    [3, ResultCode.ACCOUNT_SUSPENDED],
  ])(
    'throws the correct code when user_status=%i',
    async (userStatus, expected) => {
      jwtService.verifyAsync.mockResolvedValueOnce(validPayload);
      spExecutor.callProcedure.mockResolvedValueOnce({
        result: 0,
        data: [{ user_id: 1, company_id: 1, user_status: userStatus }],
      });
      const { context } = buildContext({ Authorization: 'Bearer valid-token' });

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        resultCode: expected,
      });
    },
  );

  it('attaches request.user, returns true, and caches the session on a DB miss->success', async () => {
    jwtService.verifyAsync.mockResolvedValueOnce(validPayload);
    spExecutor.callProcedure.mockResolvedValueOnce({
      result: 0,
      data: [{ user_id: 1, company_id: 1, user_status: 1 }],
    });
    const { context, request } = buildContext({
      Authorization: 'Bearer valid-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      userId: 1,
      companyId: 1,
      roleCode: 10,
      jti: 'jti-1',
    });
    expect(sessionCache.cacheSession).toHaveBeenCalledWith('jti-1', 1, 1);
  });

  describe('session cache hit', () => {
    it('skips the DB call entirely and attaches request.user from the cache', async () => {
      jwtService.verifyAsync.mockResolvedValueOnce(validPayload);
      sessionCache.getCachedSession.mockResolvedValueOnce({
        userId: 1,
        companyId: 1,
      });
      const { context, request } = buildContext({
        Authorization: 'Bearer valid-token',
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual({
        userId: 1,
        companyId: 1,
        roleCode: 10,
        jti: 'jti-1',
      });
      expect(spExecutor.callProcedure).not.toHaveBeenCalled();
    });
  });
});
