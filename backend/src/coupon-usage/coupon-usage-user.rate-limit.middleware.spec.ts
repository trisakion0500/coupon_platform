import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { RedisService } from '../common/redis/redis.service';
import { CouponUsageUserRateLimitMiddleware } from './coupon-usage-user.rate-limit.middleware';

function buildConfigService(): ConfigService {
  const values: Record<string, number> = {
    COUPON_USAGE_USER_RATE_LIMIT_WINDOW_SEC: 60,
    COUPON_USAGE_USER_RATE_LIMIT_MAX: 1,
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

describe('CouponUsageUserRateLimitMiddleware', () => {
  let redisService: jest.Mocked<
    Pick<RedisService, 'get' | 'incrWithExpire'>
  > & { isEnabled: boolean };
  let middleware: CouponUsageUserRateLimitMiddleware;
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    redisService = {
      isEnabled: true,
      get: jest.fn().mockResolvedValue(null),
      incrWithExpire: jest.fn().mockResolvedValue(1),
    };
    middleware = new CouponUsageUserRateLimitMiddleware(
      redisService as unknown as RedisService,
      buildConfigService(),
    );
    next = jest.fn();
  });

  it('REDIS_ENABLED=false면 Redis를 건드리지 않고 통과시킨다', async () => {
    redisService.isEnabled = false;
    const req = {
      header: jest.fn(),
      body: { game_user_id: 'player-1' },
    } as unknown as Request;
    const { response } = buildResponse();

    await middleware.use(req, response, next);

    expect(next).toHaveBeenCalled();
    expect(redisService.incrWithExpire).not.toHaveBeenCalled();
  });

  it('game_user_id가 없으면 건드리지 않고 통과시킨다', async () => {
    const req = {
      header: jest.fn(),
      body: {},
    } as unknown as Request;
    const { response } = buildResponse();

    await middleware.use(req, response, next);

    expect(next).toHaveBeenCalled();
    expect(redisService.incrWithExpire).not.toHaveBeenCalled();
  });

  it('한도 이내면 통과시킨다', async () => {
    const req = {
      header: jest.fn().mockReturnValue('api-key-1'),
      body: { game_user_id: 'player-1' },
      ip: '127.0.0.1',
    } as unknown as Request;
    const { response, statusSpy } = buildResponse();

    await middleware.use(req, response, next);

    expect(next).toHaveBeenCalled();
    expect(statusSpy).not.toHaveBeenCalled();
  });

  it('한도를 넘으면 429 + Retry-After 헤더로 거부한다', async () => {
    redisService.incrWithExpire.mockResolvedValue(2); // maxRequests=1을 이미 초과
    const req = {
      header: jest.fn().mockReturnValue('api-key-1'),
      body: { game_user_id: 'player-1' },
      ip: '127.0.0.1',
    } as unknown as Request;
    const { response, statusSpy, setHeaderSpy, jsonSpy } = buildResponse();

    await middleware.use(req, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledWith(429);
    expect(setHeaderSpy).toHaveBeenCalledWith(
      'Retry-After',
      expect.any(String),
    );
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ result: 40001 }),
    );
  });

  it('X-API-Key 헤더가 없으면 IP로 폴백해 키를 만든다', async () => {
    const req = {
      header: jest.fn().mockReturnValue(undefined),
      body: { game_user_id: 'player-1' },
      ip: '127.0.0.1',
    } as unknown as Request;
    const { response } = buildResponse();

    await middleware.use(req, response, next);

    expect(redisService.incrWithExpire).toHaveBeenCalledWith(
      expect.stringContaining('127.0.0.1:player-1'),
      expect.any(Number),
    );
  });
});
