import { Injectable } from '@nestjs/common';
import { LogSpExecutorService } from '../common/database/log-sp-executor.service';
import { ProjectIdentityCacheService } from '../common/project-identity-cache/project-identity-cache.service';

type RateLimitScope = 'PROJECT' | 'USER';
type RateLimitAction = 'RESERVE' | 'CONFIRM';

interface RateLimitLogParams {
  limitScope: RateLimitScope;
  action: RateLimitAction;
  /** 리미터 버킷 키로 쓴 것과 동일한 값(X-API-Key 헤더 원문, 없으면 IP/'unknown' 폴백) */
  apiKey: string;
  /** USER 스코프에서만 값 존재, PROJECT 스코프는 항상 null */
  gameUserId: string | null;
  retryAfterSec: number;
  callerIp: string | null;
}

/**
 * `log_coupon_rate_limit` 적재 공용 래퍼. `CouponUsageRateLimitMiddleware`(프로젝트 단위)/
 * `CouponUsageUserRateLimitMiddleware`(유저 단위) 둘 다 429를 반환할 때 이 서비스를
 * fire-and-forget으로 호출한다(`AuditLogService.record`와 동일 패턴) — 429 응답 자체는
 * 이 호출을 기다리지 않는다.
 *
 * `project_id`/`company_id`는 `ProjectIdentityCacheService`로 해석하는데, 이 시점엔 아직
 * `S2sAuthGuard`의 서명 검증 전이라 `apiKey`가 실제로 유효한지조차 모른다 — 존재하지 않는
 * api_key(스캐닝성 트래픽 등)면 해석 실패로 null이 되고, 그대로 로그에 NULL로 남는다.
 *
 * @author trisakion
 */
@Injectable()
export class RateLimitLogService {
  constructor(
    private readonly projectIdentityCache: ProjectIdentityCacheService,
    private readonly logSpExecutor: LogSpExecutorService,
  ) {}

  async record(params: RateLimitLogParams): Promise<void> {
    const identity = await this.projectIdentityCache.resolve(params.apiKey);

    await this.logSpExecutor.logCall('SP_LOG_COUPON_RATE_LIMIT_CREATE', [
      params.limitScope === 'PROJECT' ? 10 : 20,
      params.action === 'RESERVE' ? 10 : 20,
      params.apiKey,
      identity?.projectId ?? null,
      identity?.companyId ?? null,
      params.gameUserId,
      params.retryAfterSec,
      params.callerIp,
    ]);
  }
}
