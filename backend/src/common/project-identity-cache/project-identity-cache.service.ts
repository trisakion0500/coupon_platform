import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SpExecutorService } from '../database/sp-executor.service';
import { RedisService } from '../redis/redis.service';

export interface ProjectIdentity {
  projectId: number;
  companyId: number;
}

interface IdentityRow {
  project_id: number;
  company_id: number;
}

/**
 * `api_key -> {project_id, company_id}` 해석 전용 캐시. `log_coupon_rate_limit` 적재
 * (`CouponUsageRateLimitMiddleware`/`CouponUsageUserRateLimitMiddleware`)가 429 리젝트
 * 시점에 쓴다 — 이 시점엔 아직 `S2sAuthGuard`의 서명 검증 전이라 원문 `api_key` 헤더값뿐이다.
 *
 * `project.api_key`/`company_id`는 생성 이후 절대 안 바뀌는 값이라(재발급/회사이관 기능 없음)
 * 캐시가 "틀린 값"을 들고 있을 위험 자체가 없다 — 그래서 무효화 로직 없이 긴 TTL
 * (`PROJECT_API_KEY_CACHE_TTL_SEC`, 기본 30일)만으로 충분하다. `ProjectService.create()`가
 * 성공 직후 write-through로 채워두고(`cacheIdentity`), 캐시 미스(TTL 만료/최초 조회/Redis
 * 비활성)면 `SP_PROJECT_GET_IDENTITY_BY_API_KEY`로 폴백해서 채운다.
 *
 * `SessionCacheService`와 동일하게 절대 throw하지 않는다 — 이 서비스는 로깅(관측) 용도의
 * 부가 정보 조회일 뿐이라, 실패하면 조용히 null로 수렴시켜 호출부(레이트리밋 미들웨어)의
 * 429 응답 흐름에 전혀 영향을 주지 않는다.
 *
 * @author trisakion
 */
@Injectable()
export class ProjectIdentityCacheService {
  private readonly logger = new Logger(ProjectIdentityCacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly spExecutor: SpExecutorService,
    private readonly configService: ConfigService,
  ) {}

  /** api_key -> {project_id, company_id} 해석. 못 찾으면(존재하지 않는 api_key 포함) null. */
  async resolve(apiKey: string): Promise<ProjectIdentity | null> {
    const cached = await this.readCache(apiKey);
    if (cached !== undefined) {
      return cached;
    }

    try {
      const { result, data } = await this.spExecutor.callProcedure<
        IdentityRow[]
      >('SP_PROJECT_GET_IDENTITY_BY_API_KEY', [apiKey]);

      if (result !== 0 || !data?.[0]) {
        return null;
      }

      const identity: ProjectIdentity = {
        projectId: data[0].project_id,
        companyId: data[0].company_id,
      };
      await this.writeCache(apiKey, identity);
      return identity;
    } catch (err) {
      this.logger.warn(
        `identity resolve failed for api key, logging without project/company: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * `ProjectService.create()` 성공 직후 write-through로 호출한다. 실패해도 무시 — 다음
   * `resolve()` 호출이 캐시 미스로 SP 폴백을 타면서 자연히 채워진다.
   */
  async cacheIdentity(
    apiKey: string,
    projectId: number,
    companyId: number,
  ): Promise<void> {
    await this.writeCache(apiKey, { projectId, companyId });
  }

  /** 캐시가 비활성이거나 미스면 undefined(호출부가 SP 폴백을 타야 함을 의미) — null(해석 실패)과 구분. */
  private async readCache(
    apiKey: string,
  ): Promise<ProjectIdentity | null | undefined> {
    if (!this.redis.isEnabled) {
      return undefined;
    }
    try {
      const raw = await this.redis.get(this.cacheKey(apiKey));
      if (!raw) {
        return undefined;
      }
      return JSON.parse(raw) as ProjectIdentity;
    } catch (err) {
      this.logger.warn(
        `identity cache read failed, falling back to SP: ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  private async writeCache(
    apiKey: string,
    identity: ProjectIdentity,
  ): Promise<void> {
    if (!this.redis.isEnabled) {
      return;
    }
    try {
      await this.redis.set(
        this.cacheKey(apiKey),
        JSON.stringify(identity),
        this.configService.getOrThrow<number>('PROJECT_API_KEY_CACHE_TTL_SEC'),
      );
    } catch (err) {
      this.logger.warn(
        `identity cache write failed: ${(err as Error).message}`,
      );
    }
  }

  private cacheKey(apiKey: string): string {
    return `project:apikey:${apiKey}`;
  }
}
