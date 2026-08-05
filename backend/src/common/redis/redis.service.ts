import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * `REDIS_ENABLED` 뒤에서 ioredis 클라이언트를 감싸는 공용 서비스.
 *
 * `REDIS_ENABLED=false`면 클라이언트를 아예 만들지 않는다 — 이 상태에서 `setNx`를
 * 호출하는 건 호출부 버그이므로 예외를 던진다(호출부는 반드시 `isEnabled`를 먼저 확인해야 함).
 *
 * `enableOfflineQueue: false` + `maxRetriesPerRequest: 1`을 쓰는 이유: Redis가 응답하지
 * 않을 때 커맨드를 무한정 큐잉하며 요청을 붙잡는 대신 즉시 실패시켜야, 호출부(예:
 * `S2sAuthGuard`)의 fail-open(DB 경로 폴백) 로직이 지체 없이 발동한다.
 *
 * @author trisakion
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | undefined;

  constructor(private readonly configService: ConfigService) {}

  get isEnabled(): boolean {
    return !!this.configService.get<boolean>('REDIS_ENABLED');
  }

  onModuleInit(): void {
    if (!this.isEnabled) {
      return;
    }

    this.client = new Redis({
      host: this.configService.getOrThrow<string>('REDIS_HOST'),
      port: this.configService.getOrThrow<number>('REDIS_PORT'),
      password: this.configService.get<string>('REDIS_PASSWORD') || undefined,
      keyPrefix: this.configService.getOrThrow<string>('REDIS_KEY_PREFIX'),
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    });

    // ioredis는 'error' 리스너가 없으면 연결 오류가 unhandled exception으로 프로세스를
    // 죽일 수 있다 — 로깅만 하고 흡수한다. 재연결 자체는 retryStrategy가 백그라운드로 계속 시도한다.
    this.client.on('error', (err: Error) => {
      this.logger.warn(`Redis connection error: ${err.message}`);
    });
  }

  /**
   * `client.quit()` 실패(예: Redis가 이미 다운된 상태 — `enableOfflineQueue: false`라
   * 즉시 reject됨)를 흡수한다. 이걸 흡수하지 않으면 정상 종료(SIGTERM) 도중 이 모듈의
   * `onModuleDestroy`가 reject되어, `DatabaseModule` 등 다른 모듈의 정리 작업까지
   * 흐트러질 수 있다(04_DEV_CONVENTIONS.md 4.1 "정상 종료 훅은 항상 끝까지 이어져야 한다"
   * 원칙과 같은 결).
   */
  async onModuleDestroy(): Promise<void> {
    if (!this.client) {
      return;
    }
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.warn(
        `Redis quit failed during shutdown: ${(err as Error).message}`,
      );
    }
  }

  /**
   * nonce 재전송 방지용 원자적 SET NX EX. 성공(신규 nonce)이면 true, 이미 존재(재전송)하면
   * false를 반환한다. Redis 자체가 응답하지 못하면(연결 끊김/타임아웃) 예외를 그대로 던진다 —
   * 이건 호출부가 "재전송이 아니라 인프라 장애"로 구분해 DB 경로로 폴백해야 하는 신호다.
   */
  async setNx(key: string, ttlSec: number): Promise<boolean> {
    if (!this.client) {
      throw new Error('RedisService.setNx called while Redis is disabled');
    }
    const result = await this.client.set(key, '1', 'EX', ttlSec, 'NX');
    return result === 'OK';
  }
}
