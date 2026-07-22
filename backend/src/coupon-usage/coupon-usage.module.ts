import { Module } from '@nestjs/common';
import { S2sAuthModule } from '../common/s2s-auth/s2s-auth.module';
import { CouponUsageController } from './coupon-usage.controller';
import { CouponUsageService } from './coupon-usage.service';

/**
 * 18_COUPON_USAGE_API.md 2~3장 도메인 모듈 — reserve/confirm + 미컨슘 조회 3개 S2S 엔드포인트.
 *
 * @author trisakion
 */
@Module({
  imports: [S2sAuthModule],
  controllers: [CouponUsageController],
  providers: [CouponUsageService],
})
export class CouponUsageModule {}
