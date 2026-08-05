import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Redis 접근 공용 모듈. `DatabaseModule`/`AuditLogModule`과 동일하게 전역(`@Global`)으로
 * 노출해 다른 모듈이 매번 import하지 않아도 `RedisService`를 주입받을 수 있게 한다
 * (`S2sAuthModule`이 `CryptoModule` export를 빠뜨려 겪었던 DI 오류를 반복하지 않기 위함).
 *
 * @author trisakion
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
