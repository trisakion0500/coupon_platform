import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cron from 'node-cron';
import { SpExecutorService } from '../database/sp-executor.service';

/**
 * 08_API_COMMON.md 5.4: 만료된 `user_session`을 주기적으로 물리 삭제하는 배치.
 * 서버 기동 시 `SESSION_CLEANUP_CRON` 스케줄로 등록한다.
 *
 * @author trisakion
 */
@Injectable()
export class SessionCleanupService implements OnModuleInit {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly spExecutor: SpExecutorService,
  ) {}

  /** 서버 기동 시 크론 스케줄을 등록한다. */
  onModuleInit(): void {
    const schedule = this.configService.getOrThrow<string>(
      'SESSION_CLEANUP_CRON',
    );
    cron.schedule(schedule, () => {
      void this.cleanup();
    });
  }

  /** 배치 실패는 서버 로그로만 남기고, 스케줄러 자체가 죽지 않도록 절대 throw하지 않는다. */
  private async cleanup(): Promise<void> {
    try {
      const { result } = await this.spExecutor.callProcedure(
        'SP_SESSION_CLEANUP',
        [],
      );
      if (result !== 0) {
        this.logger.error(`SP_SESSION_CLEANUP returned RESULT=${result}`);
      }
    } catch (err) {
      this.logger.error(`SP_SESSION_CLEANUP failed: ${(err as Error).message}`);
    }
  }
}
