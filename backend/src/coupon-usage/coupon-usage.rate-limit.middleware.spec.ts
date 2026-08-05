import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { CouponUsageRateLimitMiddleware } from './coupon-usage.rate-limit.middleware';
import { RateLimitLogService } from './rate-limit-log.service';

function buildConfigService(): ConfigService {
  const values: Record<string, number> = {
    COUPON_USAGE_RATE_LIMIT_BUCKET_CAPACITY: 1,
    COUPON_USAGE_RATE_LIMIT_REFILL_PER_SEC: 1,
  };
  return {
    getOrThrow: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function buildResponse(): {
  response: Response;
  setHeaderSpy: jest.Mock;
  statusSpy: jest.Mock;
  jsonSpy: jest.Mock;
} {
  const setHeaderSpy = jest.fn();
  const statusSpy = jest.fn().mockReturnThis();
  const jsonSpy = jest.fn().mockReturnThis();
  const response = {
    setHeader: setHeaderSpy,
    status: statusSpy,
    json: jsonSpy,
  } as unknown as Response;
  return { response, setHeaderSpy, statusSpy, jsonSpy };
}

describe('CouponUsageRateLimitMiddleware', () => {
  let rateLimitLog: jest.Mocked<Pick<RateLimitLogService, 'record'>>;
  let middleware: CouponUsageRateLimitMiddleware;
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    rateLimitLog = { record: jest.fn().mockResolvedValue(undefined) };
    middleware = new CouponUsageRateLimitMiddleware(
      buildConfigService(),
      rateLimitLog as unknown as RateLimitLogService,
    );
    next = jest.fn();
  });

  it('용량 이내면 통과시키고 레이트리밋 로그를 남기지 않는다', () => {
    const req = {
      header: jest.fn().mockReturnValue('api-key-1'),
      path: '/v1/coupons/CODE1/reserve',
      ip: '127.0.0.1',
    } as unknown as Request;
    const { response, statusSpy } = buildResponse();

    middleware.use(req, response, next);

    expect(next).toHaveBeenCalled();
    expect(statusSpy).not.toHaveBeenCalled();
    expect(rateLimitLog.record).not.toHaveBeenCalled();
  });

  it('용량을 초과하면 429 + Retry-After로 거부하고 레이트리밋 로그를 남긴다(PROJECT 스코프, game_user_id는 항상 NULL)', () => {
    const req = {
      header: jest.fn().mockReturnValue('api-key-1'),
      path: '/v1/coupons/CODE1/confirm',
      ip: '127.0.0.1',
    } as unknown as Request;
    const { response: r1 } = buildResponse();
    middleware.use(req, r1, next); // 용량(1) 소진

    const { response: r2, statusSpy, setHeaderSpy, jsonSpy } = buildResponse();
    middleware.use(req, r2, next);

    expect(statusSpy).toHaveBeenCalledWith(429);
    expect(setHeaderSpy).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ result: 40001 }),
    );
    expect(rateLimitLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        limitScope: 'PROJECT',
        action: 'CONFIRM',
        apiKey: 'api-key-1',
        gameUserId: null,
        callerIp: '127.0.0.1',
      }),
    );
    const [[recordedArgs]] = rateLimitLog.record.mock.calls;
    expect(recordedArgs.retryAfterSec).toBeGreaterThan(0);
  });

  it('X-API-Key 헤더가 없으면 IP로 폴백해 키를 만든다', () => {
    const req = {
      header: jest.fn().mockReturnValue(undefined),
      path: '/v1/coupons/CODE1/reserve',
      ip: '127.0.0.1',
    } as unknown as Request;
    const { response: r1 } = buildResponse();
    middleware.use(req, r1, next); // 용량(1) 소진

    const { response: r2 } = buildResponse();
    middleware.use(req, r2, next);

    expect(rateLimitLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: '127.0.0.1' }),
    );
  });
});
