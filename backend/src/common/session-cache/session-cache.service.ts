import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

interface CachedSession {
  userId: number;
  companyId: number;
  generation: number;
}

/**
 * `JwtAuthGuard.validateSession`(매 인증된 요청마다 도는 jti→세션 검증, `SP_USER_SESSION_VALIDATE_BY_JTI`)의
 * 읽기 캐시. DB가 여전히 source of truth이고 이 서비스는 순수 캐시 — nonce(`S2sAuthGuard`)처럼
 * "Redis 우선/DB 폴백" 구조가 아니라 항상 DB가 최종 권위를 갖는다.
 *
 * **무효화는 유저 단위 generation 카운터로 처리한다** — jti별 캐시 항목을 개별 삭제하는 대신,
 * 캐시에는 `{세션정보, 그 시점의 generation}`을 함께 저장해두고, 조회 시 캐시된 generation과
 * 그 유저의 "현재 generation"이 같을 때만 히트로 인정한다. 로그아웃/비밀번호변경/계정정지가
 * 일어나면 `invalidateUser`로 현재 generation만 올리면, 그 유저의 캐시된 세션이 몇 개(여러
 * 기기)든 다음 조회 시점에 한꺼번에 미스로 전환된다.
 *
 * **카운터 TTL이 캐시 TTL보다 항상 커야 한다** — 카운터가 캐시보다 먼저 만료돼 0으로 리셋되면,
 * 아직 살아있는 옛날 캐시 항목(리셋 이전 값으로 캐싱된)의 generation과 우연히 일치해버려
 * 무효화가 원상복구되는 보안 구멍이 생긴다. 이 관계는 `env.validation.ts`가 부팅 시점에
 * `Joi.ref()`로 강제한다(`SESSION_CACHE_GENERATION_TTL_SEC > SESSION_CACHE_TTL_SEC`).
 *
 * **레이스 완화, 완전 해소는 아님(2026-08-05 동시성 감사에서 발견)**: `cacheSession`이
 * DB 검증 성공 이후에야 generation을 읽을 수 있는 구조적 갭 때문에, 그 사이 무효화가 끼어들면
 * 방금 무효화된 세션을 오히려 새로 캐싱해버릴 수 있다 — DB(MySQL)와 캐시(Redis)가 물리적으로
 * 다른 시스템이라 이 갭 자체는 완전히 닫을 수 없고, `cacheSession` 내부의 write-후-재확인으로
 * 창을 좁히는 완화만 적용돼 있다(상세 이유는 그 메서드 주석 참고). 최악의 경우도 캐시 TTL로
 * 상한이 걸린다(무한정 유효해지지 않음). `refresh()`의 `evictJti`는 generation과 무관한 단순
 * 키 삭제라 같은 방식의 완화조차 적용할 수 없는 별개의 레이스가 남아있으나(같은 유저의 여전히
 * 유효한 세션이 옛 jti로 잠깐 더 도는 수준이라 권한 상승 위험은 없음), 낮은 심각도로 판단해
 * 의도적으로 손대지 않았다.
 *
 * 이 서비스는 절대 throw하지 않는다 — Redis 에러/미스/generation 불일치는 전부 "캐시 미스"로
 * 수렴시켜 호출부가 항상 안전하게 DB로 폴백하게 한다. 단 `invalidateUser` 실패만은 ERROR로
 * 로깅한다 — 이건 조용히 넘어가면 "무효화가 최대 캐시 TTL만큼 늦어질 수 있다"는 보안 관련
 * 신호라 관측 가능해야 한다.
 *
 * @author trisakion
 */
@Injectable()
export class SessionCacheService {
  private readonly logger = new Logger(SessionCacheService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /** jti → `{userId, companyId}` 조회. 히트가 아니면(비활성/미스/generation불일치/에러) null. */
  async getCachedSession(
    jti: string,
  ): Promise<{ userId: number; companyId: number } | null> {
    if (!this.redis.isEnabled) {
      return null;
    }
    try {
      const raw = await this.redis.get(this.sessionKey(jti));
      if (!raw) {
        return null;
      }
      const cached = JSON.parse(raw) as CachedSession;
      const currentGeneration = await this.getCurrentGeneration(cached.userId);
      if (cached.generation !== currentGeneration) {
        return null;
      }
      return { userId: cached.userId, companyId: cached.companyId };
    } catch (err) {
      this.logger.warn(
        `session cache read failed for jti, falling back to DB: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * DB 검증이 성공(status=1)했을 때만 호출 — 현재 generation과 함께 저장한다.
   *
   * **레이스 완화(이중 확인)**: `JwtAuthGuard`가 DB 검증에 성공한 시점과 이 메서드가 실제로
   * generation을 읽는 시점 사이에는 필연적인 갭이 있다(호출자가 jti만 갖고 있고, userId를
   * 알아야 generation을 읽을 수 있는데 userId 자체가 DB 검증 결과이기 때문 — 구조적으로
   * "검증 성공"보다 먼저 읽을 방법이 없다). 그 갭 사이에 같은 유저의 로그아웃/비밀번호변경/
   * 계정정지가 끼어들면, 그 무효화가 만든 새 generation을 오히려 "방금 확인된 유효한 세션"에
   * 실어 캐싱해버릴 수 있다 — MySQL과 Redis가 물리적으로 다른 시스템이라 이 갭 자체를 완전히
   * 닫는 건 불가능하다(진짜 분산 트랜잭션 없이는). 대신 write 직후 generation을 한 번 더 읽어
   * 그 사이 바뀌었으면 방금 쓴 값을 즉시 지운다 — 레이스 창을 "DB 왕복 1회" 수준에서 "Redis
   * 명령 1회" 수준으로 크게 좁힌다(이 재확인 자체도 이론적으로 레이스가 없는 건 아니지만,
   * Redis 로컬 커맨드 하나의 시간으로 수렴해 실질적으로 무시 가능한 수준이 된다).
   */
  async cacheSession(
    jti: string,
    userId: number,
    companyId: number,
  ): Promise<void> {
    if (!this.redis.isEnabled) {
      return;
    }
    try {
      const generation = await this.getCurrentGeneration(userId);
      const value: CachedSession = { userId, companyId, generation };
      await this.redis.set(
        this.sessionKey(jti),
        JSON.stringify(value),
        this.cacheTtlSec(),
      );

      const generationAfterWrite = await this.getCurrentGeneration(userId);
      if (generationAfterWrite !== generation) {
        await this.redis.del(this.sessionKey(jti));
      }
    } catch (err) {
      this.logger.warn(
        `session cache write failed for jti: ${(err as Error).message}`,
      );
    }
  }

  /** refresh로 jti가 회전될 때 이전 jti의 캐시 항목만 정밀 삭제한다(다른 기기 세션은 안 건드림). */
  async evictJti(jti: string): Promise<void> {
    if (!this.redis.isEnabled) {
      return;
    }
    try {
      await this.redis.del(this.sessionKey(jti));
    } catch (err) {
      this.logger.warn(
        `session cache evict failed for jti: ${(err as Error).message}`,
      );
    }
  }

  /** 로그아웃/비밀번호변경/비밀번호초기화/계정정지 트리거 — 그 유저의 캐시 전체를 미스나게 만든다. */
  async invalidateUser(userId: number): Promise<void> {
    if (!this.redis.isEnabled) {
      return;
    }
    try {
      await this.redis.incrWithExpire(
        this.generationKey(userId),
        this.generationTtlSec(),
      );
    } catch (err) {
      this.logger.error(
        `session cache invalidation failed for user ${userId} — stale cache may serve up to ${this.cacheTtlSec()}s: ${(err as Error).message}`,
      );
    }
  }

  private async getCurrentGeneration(userId: number): Promise<number> {
    const raw = await this.redis.get(this.generationKey(userId));
    return raw ? Number(raw) : 0;
  }

  private sessionKey(jti: string): string {
    return `session:jti:${jti}`;
  }

  private generationKey(userId: number): string {
    return `session:gen:${userId}`;
  }

  private cacheTtlSec(): number {
    return this.configService.getOrThrow<number>('SESSION_CACHE_TTL_SEC');
  }

  private generationTtlSec(): number {
    return this.configService.getOrThrow<number>(
      'SESSION_CACHE_GENERATION_TTL_SEC',
    );
  }
}
