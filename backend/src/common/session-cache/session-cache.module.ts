import { Global, Module } from '@nestjs/common';
import { SessionCacheService } from './session-cache.service';

/**
 * 세션 검증 읽기 캐시 공용 모듈. `RedisModule`/`DatabaseModule`과 동일하게 전역(`@Global`)으로
 * 노출해 `JwtAuthGuard`/`AuthService`/`UserService`가 매번 import하지 않아도
 * `SessionCacheService`를 주입받을 수 있게 한다.
 *
 * @author trisakion
 */
@Global()
@Module({
  providers: [SessionCacheService],
  exports: [SessionCacheService],
})
export class SessionCacheModule {}
