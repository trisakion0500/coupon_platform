import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { RedisService } from '../common/redis/redis.service';
import { ResultCode } from '../common/response/result-code.enum';
import { SlidingWindowCounterLimiter } from './sliding-window-counter-limiter';

/**
 * 09_AUTH_SECURITY.md 2.8: reserve/confirm에 **유저(game_user_id) 단위** 요청 제한을
 * 추가로 적용한다 — `CouponUsageRateLimitMiddleware`(프로젝트 단위, in-memory 토큰버킷)와는
 * 별개 레이어로, 목적은 인프라 보호가 아니라 특정 유저 한 명이 같은 프로젝트의 공유 버킷을
 * 과도하게 소진해 다른 유저까지 영향받는 상황을 막는 것이다(2차 방어, 필수는 아님 —
 * `README.md` "향후 개선사항" 참고).
 *
 * `REDIS_ENABLED=false`면 이 레이어는 **완전히 스킵**한다(폴백 없음) — 프로젝트 단위
 * 리미터와 달리 이 기능은 애초에 Redis 없이 구현한 적이 없어 대체할 in-memory 경로 자체가
 * 없다. Redis가 켜져 있는데 커맨드가 실패하면(연결 끊김 등) `SlidingWindowCounterLimiter`
 * 내부에서 fail-open(허용)으로 흡수한다.
 *
 * 키는 프로젝트 단위 리미터와 동일하게 `X-API-Key` 원문 헤더값(서명 검증 전, 파티셔닝
 * 목적에는 충분)에 `game_user_id`를 더해 만든다. `game_user_id`가 바디에 없으면(형식오류
 * 등) 이 레이어는 건너뛴다 — 어차피 서비스 레이어가 곧 30001로 거부하므로 이중 처리가
 * 불필요하다.
 *
 * @author trisakion
 */
@Injectable()
export class CouponUsageUserRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: SlidingWindowCounterLimiter;

  constructor(
    private readonly redisService: RedisService,
    configService: ConfigService,
  ) {
    this.limiter = new SlidingWindowCounterLimiter(
      redisService,
      configService.getOrThrow<number>(
        'COUPON_USAGE_USER_RATE_LIMIT_WINDOW_SEC',
      ),
      configService.getOrThrow<number>('COUPON_USAGE_USER_RATE_LIMIT_MAX'),
    );
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (!this.redisService.isEnabled) {
      next();
      return;
    }

    const body = req.body as { game_user_id?: unknown } | undefined;
    const gameUserId = body?.game_user_id;
    if (typeof gameUserId !== 'string' || gameUserId.length === 0) {
      next();
      return;
    }

    const apiKeyOrIp = req.header('X-API-Key') ?? req.ip ?? 'unknown';
    const { allowed, retryAfterSec } = await this.limiter.tryConsume(
      `${apiKeyOrIp}:${gameUserId}`,
    );

    if (!allowed) {
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        result: ResultCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests',
      });
      return;
    }

    next();
  }
}
