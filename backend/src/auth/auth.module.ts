import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module';
import { JwtAuthModule } from '../common/jwt-auth/jwt-auth.module';
import { AuthController } from './auth.controller';
import { AuthRateLimitMiddleware } from './auth.rate-limit.middleware';
import { AuthService } from './auth.service';

/**
 * 09_AUTH_API.md 도메인 모듈 — signup/login/logout/refresh/me/password 6개 엔드포인트.
 *
 * @author trisakion
 */
@Module({
  imports: [JwtAuthModule, CryptoModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(AuthRateLimitMiddleware)
      .forRoutes(
        { path: 'auth/signup', method: RequestMethod.POST },
        { path: 'auth/login', method: RequestMethod.POST },
      );
  }
}
