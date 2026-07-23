import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit, RateLimitRequestHandler } from 'express-rate-limit';
import { ResultCode } from '../common/response/result-code.enum';

/**
 * 07_AUTH_SECURITY.md 2.8: reserve/confirm S2S 엔드포인트에 프로젝트(API Key) 기준 요청 제한 —
 * 인프라 보호 목적(특정 게임서버의 비정상 트래픽 폭주 방지)이라 `AuthRateLimitMiddleware`와
 * 동일하게 in-memory `express-rate-limit`을 그대로 재사용한다(2026-07-23, README "향후
 * 개선사항" 중 프로젝트 단위만 채택 — 프로젝트·유저 이중 적용은 보류).
 *
 * `X-API-Key` 헤더값을 그대로 카운터 키로 쓴다 — `S2sAuthGuard`가 서명/nonce까지 검증한
 * 값이 아니라 미들웨어 단계의 원문 헤더값일 뿐이지만, 프로젝트별로 카운터를 나누는 목적에는
 * 그걸로 충분하다(로그인 리미터가 IP 소유권을 검증하지 않고 그대로 키로 쓰는 것과 동일한 성격).
 * 헤더가 없으면(형식 오류 등, 어차피 가드가 뒤에서 10012로 거부) IP로 폴백해 리미터 자체가
 * 죽지 않게만 한다.
 *
 * @author trisakion
 */
@Injectable()
export class CouponUsageRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RateLimitRequestHandler;

  constructor(configService: ConfigService) {
    this.limiter = rateLimit({
      windowMs: configService.getOrThrow<number>(
        'COUPON_USAGE_RATE_LIMIT_WINDOW_MS',
      ),
      limit: configService.getOrThrow<number>('COUPON_USAGE_RATE_LIMIT_MAX'),
      standardHeaders: true,
      legacyHeaders: false,
      statusCode: 429,
      message: {
        result: ResultCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests',
      },
      keyGenerator: (req: Request) =>
        req.header('X-API-Key') ?? req.ip ?? 'unknown',
    });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.limiter(req, res, next);
  }
}
