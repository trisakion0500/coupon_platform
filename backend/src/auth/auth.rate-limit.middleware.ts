import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit, RateLimitRequestHandler } from 'express-rate-limit';
import { ResultCode } from '../common/response/result-code.enum';

/**
 * 09_AUTH_SECURITY.md 1.4: 로그인/회원가입 IP당 요청 제한. `/auth/signup`, `/auth/login`에만 적용한다
 * (refresh는 유효한 refresh token 보유가 전제라 대상에서 제외).
 *
 * @author trisakion
 */
@Injectable()
export class AuthRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RateLimitRequestHandler;

  constructor(configService: ConfigService) {
    this.limiter = rateLimit({
      windowMs: configService.getOrThrow<number>('LOGIN_RATE_LIMIT_WINDOW_MS'),
      limit: configService.getOrThrow<number>('LOGIN_RATE_LIMIT_MAX'),
      standardHeaders: true,
      legacyHeaders: false,
      statusCode: 429,
      message: {
        result: ResultCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests',
      },
    });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    this.limiter(req, res, next);
  }
}
