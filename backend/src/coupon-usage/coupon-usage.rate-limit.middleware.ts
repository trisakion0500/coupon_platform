import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { ResultCode } from '../common/response/result-code.enum';
import { TokenBucketLimiter } from './token-bucket-limiter';

/**
 * 07_AUTH_SECURITY.md 2.8: reserve/confirm S2S 엔드포인트에 프로젝트(API Key) 기준 요청 제한 —
 * 인프라 보호 목적(특정 게임서버의 비정상 트래픽 폭주 방지). 저장소는 `AuthRateLimitMiddleware`와
 * 동일하게 in-memory를 유지하되, 알고리즘은 고정 윈도우(express-rate-limit) 대신 토큰 버킷으로
 * 교체했다(2026-07-24) — 고정 윈도우는 윈도우 경계에서 이전/다음 윈도우 최대치가 거의 동시에
 * 겹쳐 순간적으로 설정값의 2배 가까운 버스트를 허용할 수 있는 반면, 토큰 버킷은 버킷 용량이
 * 항상 그 시점의 절대 상한이라 이 문제가 구조적으로 없다. 로그인 리미터(`AuthRateLimitMiddleware`)는
 * 이번 교체 대상이 아니라 기존 고정 윈도우 그대로 유지한다.
 *
 * `X-API-Key` 헤더값을 그대로 버킷 키로 쓴다 — `S2sAuthGuard`가 서명/nonce까지 검증한 값이
 * 아니라 미들웨어 단계의 원문 헤더값일 뿐이지만, 프로젝트별로 버킷을 나누는 목적에는 그걸로
 * 충분하다(로그인 리미터가 IP 소유권을 검증하지 않고 그대로 키로 쓰는 것과 동일한 성격).
 * 헤더가 없으면(형식 오류 등, 어차피 가드가 뒤에서 10012로 거부) IP로 폴백해 리미터 자체가
 * 죽지 않게만 한다.
 *
 * 인메모리 Map 기반이라 스케일아웃 시 인스턴스별로 버킷이 나뉘어 실효 한도가 인스턴스 수배로
 * 늘어나는 한계는 기존과 동일하게 인지하고 감수한다. 호출이 끊긴 프로젝트의 버킷 엔트리가
 * Map에 무기한 남는 것도 감수한다 — 프로젝트 수는 이 플랫폼 규모상 유계(bounded)라 별도
 * 정리 배치를 둘 만큼의 메모리 위험은 아니라고 판단.
 *
 * @author trisakion
 */
@Injectable()
export class CouponUsageRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: TokenBucketLimiter;

  constructor(configService: ConfigService) {
    this.limiter = new TokenBucketLimiter(
      configService.getOrThrow<number>(
        'COUPON_USAGE_RATE_LIMIT_BUCKET_CAPACITY',
      ),
      configService.getOrThrow<number>(
        'COUPON_USAGE_RATE_LIMIT_REFILL_PER_SEC',
      ),
    );
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const key = req.header('X-API-Key') ?? req.ip ?? 'unknown';
    const { allowed, retryAfterSec } = this.limiter.tryConsume(key);

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
