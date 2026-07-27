import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../common/jwt-auth/jwt-auth.module';
import { RolesModule } from '../common/roles/roles.module';
import { CouponUseLogController } from './coupon-use-log.controller';
import { CouponUseLogService } from './coupon-use-log.service';

/**
 * 쿠폰 사용 로그 조회(19_CAMPAIGN_API.md 4.3) 모듈. `SpExecutorService`/`LogSpExecutorService`는
 * `DatabaseModule`/`LogDatabaseModule`이 전역으로 노출하므로 별도 import가 필요 없지만,
 * 컨트롤러가 쓰는 `JwtAuthGuard`/`RolesGuard`는 각자의 의존 모듈을 재노출하는
 * `JwtAuthModule`/`RolesModule`을 직접 import해야 한다(`LogAuditModule`과 동일 패턴 — 가드는
 * 자신이 선언된 모듈이 아니라 사용하는 컨트롤러가 속한 모듈의 DI 컨테이너에서 의존성을 해석한다).
 *
 * @author trisakion
 */
@Module({
  imports: [JwtAuthModule, RolesModule],
  controllers: [CouponUseLogController],
  providers: [CouponUseLogService],
})
export class CouponUseLogModule {}
