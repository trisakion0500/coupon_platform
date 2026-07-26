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
 * 08_API_COMMON.md 5.4: 만료된 `user_session`을 주기적으로 물리 삭제하는 배치.
 * 서버 기동 시 `SESSION_CLEANUP_CRON` 스케줄로 등록한다.
 *
 * @author trisakion
 */
@Injectable()
export class SessionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupService.name);
  private task: ScheduledTask | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly spExecutor: SpExecutorService,
  ) {}

  /** 서버 기동 시 크론 스케줄을 등록한다. */
  onModuleInit(): void {
    const schedule = this.configService.getOrThrow<string>(
      'SESSION_CLEANUP_CRON',
    );
    this.task = cron.schedule(schedule, () => {
      void this.cleanup();
    });
  }

  /**
   * 서버 정상 종료(SIGTERM 등, `main.ts`의 `enableShutdownHooks`) 시 크론 스케줄을 멈춘다 —
   * 이게 없으면 `SpExecutorService`의 DB pool이 먼저 닫힌 뒤에도 스케줄이 계속 발동해
   * "Pool is closed" 오류를 남길 수 있다(E2E 테스트에서 실제로 재현됨, 2026-07-26).
   */
  async onModuleDestroy(): Promise<void> {
    await this.task?.stop();
  }

  /**
   * 배치 실패는 서버 로그로만 남기고, 스케줄러 자체가 죽지 않도록 절대 throw하지 않는다.
   * `runExclusive`로 감싸 스케일아웃 시 레플리카 여러 대가 같은 스케줄에 중복 실행하지 않도록
   * 한다(스케일아웃 점검 3번, 2026-07-23) — SP 자체는 멱등이라 정합성 문제는 아니었지만
   * 레플리카 수만큼 불필요한 DB 왕복이 늘어나는 걸 막는다.
   */
  private async cleanup(): Promise<void> {
    try {
      const ran = await this.spExecutor.runExclusive(
        'coupon_platform:session_cleanup',
        async () => {
          const { result } = await this.spExecutor.callProcedure(
            'SP_SESSION_CLEANUP',
            [],
          );
          if (result !== 0) {
            this.logger.error(`SP_SESSION_CLEANUP returned RESULT=${result}`);
          }
        },
      );
      if (!ran) {
        this.logger.debug(
          'SP_SESSION_CLEANUP skipped — another instance is already running it',
        );
      }
    } catch (err) {
      this.logger.error(`SP_SESSION_CLEANUP failed: ${(err as Error).message}`);
    }
  }
}
