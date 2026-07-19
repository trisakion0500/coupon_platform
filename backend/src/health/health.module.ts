import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * GET /health 헬스체크 엔드포인트 모듈.
 *
 * @author trisakion
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
