import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { SpExecutorService } from '../database/sp-executor.service';

/**
 * 04_DATABASE_SCHEMA.md 12장: 허용 타임스탬프 범위(`S2S_TIMESTAMP_TOLERANCE_SEC`)보다 과거인
 * `project_api_nonce`를 주기적으로 물리 삭제하는 배치. 서버 기동 시 `S2S_NONCE_CLEANUP_CRON`
 * 스케줄로 등록한다(`SessionCleanupService`/`ApiSecretCleanupService`와 동일 구조) — 원래
 * 설계 시점부터 문서화된 배치였으나 실제 구현이 빠져 있던 걸 스케일아웃 점검(2026-07-23,
 * 4번 항목) 중 발견해 이번에 추가한다.
 *
 * @author trisakion
 */
@Injectable()
export class NonceCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NonceCleanupService.name);
  private task: ScheduledTask | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly spExecutor: SpExecutorService,
  ) {}

  /** 서버 기동 시 크론 스케줄을 등록한다. */
  onModuleInit(): void {
    const schedule = this.configService.getOrThrow<string>(
      'S2S_NONCE_CLEANUP_CRON',
    );
    this.task = cron.schedule(schedule, () => {
      void this.cleanup();
    });
  }

  /** 서버 정상 종료 시 크론 스케줄을 멈춘다(`SessionCleanupService`와 동일 이유). */
  async onModuleDestroy(): Promise<void> {
    await this.task?.stop();
  }

  /**
   * 배치 실패는 서버 로그로만 남기고, 스케줄러 자체가 죽지 않도록 절대 throw하지 않는다.
   * reserve/confirm 트래픽이 많으면 이 테이블이 세션/Secret 정리보다 훨씬 빠르게 커질 수 있어
   * 기본 스케줄도 10분 간격으로 훨씬 잦다(project_api_nonce.sql 헤더 주석 참고). `runExclusive`로
   * 감싸 스케일아웃 시 레플리카 여러 대가 같은 스케줄에 중복 실행하지 않도록 한다
   * (`02_DEV_CONVENTIONS.md` 4.1).
   */
  private async cleanup(): Promise<void> {
    try {
      const toleranceSec = this.configService.getOrThrow<number>(
        'S2S_TIMESTAMP_TOLERANCE_SEC',
      );
      const ran = await this.spExecutor.runExclusive(
        'coupon_platform:nonce_cleanup',
        async () => {
          const { result } = await this.spExecutor.callProcedure(
            'SP_NONCE_CLEANUP',
            [toleranceSec],
          );
          if (result !== 0) {
            this.logger.error(`SP_NONCE_CLEANUP returned RESULT=${result}`);
          }
        },
      );
      if (!ran) {
        this.logger.debug(
          'SP_NONCE_CLEANUP skipped — another instance is already running it',
        );
      }
    } catch (err) {
      this.logger.error(`SP_NONCE_CLEANUP failed: ${(err as Error).message}`);
    }
  }
}
