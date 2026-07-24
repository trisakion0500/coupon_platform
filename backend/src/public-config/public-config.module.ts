import { Module } from '@nestjs/common';
import { PublicConfigController } from './public-config.controller';

/**
 * GET /config/public 공개 설정 조회 엔드포인트 모듈.
 *
 * @author trisakion
 */
@Module({
  controllers: [PublicConfigController],
})
export class PublicConfigModule {}
