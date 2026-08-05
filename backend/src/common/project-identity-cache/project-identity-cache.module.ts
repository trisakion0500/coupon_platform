import { Global, Module } from '@nestjs/common';
import { ProjectIdentityCacheService } from './project-identity-cache.service';

/**
 * `api_key -> {project_id, company_id}` 해석 캐시 공용 모듈. `RedisModule`/`SessionCacheModule`과
 * 동일하게 전역(`@Global`)으로 노출해 `ProjectModule`(쓰기)과 `CouponUsageModule`(읽기)이
 * 서로 다른 도메인임에도 매번 import하지 않아도 `ProjectIdentityCacheService`를 주입받을 수
 * 있게 한다.
 *
 * @author trisakion
 */
@Global()
@Module({
  providers: [ProjectIdentityCacheService],
  exports: [ProjectIdentityCacheService],
})
export class ProjectIdentityCacheModule {}
