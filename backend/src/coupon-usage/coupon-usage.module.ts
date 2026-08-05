import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { S2sAuthModule } from '../common/s2s-auth/s2s-auth.module';
import { CouponUsageUserRateLimitMiddleware } from './coupon-usage-user.rate-limit.middleware';
import { CouponUsageController } from './coupon-usage.controller';
import { CouponUsageRateLimitMiddleware } from './coupon-usage.rate-limit.middleware';
import { CouponUsageService } from './coupon-usage.service';
import { RateLimitLogService } from './rate-limit-log.service';

/**
 * 20_COUPON_USAGE_API.md 2~3장 도메인 모듈 — reserve/confirm + 미컨슘 조회 3개 S2S 엔드포인트.
 *
 * @author trisakion
 */
@Module({
  imports: [S2sAuthModule],
  controllers: [CouponUsageController],
  providers: [CouponUsageService, RateLimitLogService],
})
export class CouponUsageModule implements NestModule {
  /**
   * `forRoutes` 경로에 `v1/` 접두어를 직접 붙여야 한다 — `@Controller({ version: '1' })`가
   * 버전 접두어를 붙이는 건 라우팅 단계일 뿐, 미들웨어 경로 매칭은 컨트롤러의 버전 설정을
   * 자동으로 반영하지 않는다(접두어 없이 두면 미들웨어가 조용히 아무 요청도 못 잡는다 —
   * 실제로 실서버 스모크에서 이렇게 재현된 뒤 발견).
   */
  configure(consumer: MiddlewareConsumer): void {
    // 프로젝트 단위(저렴한 in-memory 체크)가 먼저 걸러야 유저 단위(Redis 커맨드)로
    // 불필요한 부하가 넘어가지 않는다 — 순서를 바꾸지 말 것.
    consumer
      .apply(CouponUsageRateLimitMiddleware, CouponUsageUserRateLimitMiddleware)
      .forRoutes(
        { path: 'v1/coupons/:code/reserve', method: RequestMethod.POST },
        { path: 'v1/coupons/:code/confirm', method: RequestMethod.POST },
      );
  }
}
