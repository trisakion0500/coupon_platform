import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cron from 'node-cron';
import { SpExecutorService } from '../database/sp-executor.service';

/**
 * 07_AUTH_SECURITY.md 2.6: 유예기간이 지난 `project.api_secret_prev`를 주기적으로 NULL 처리하는
 * 배치. 서버 기동 시 `API_SECRET_CLEANUP_CRON` 스케줄로 등록한다(`SessionCleanupService`와 동일한
 * 구조).
 *
 * @author trisakion
 */
@Injectable()
export class ApiSecretCleanupService implements OnModuleInit {
  private readonly logger = new Logger(ApiSecretCleanupService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly spExecutor: SpExecutorService,
  ) {}

  /** 서버 기동 시 크론 스케줄을 등록한다. */
  onModuleInit(): void {
    const schedule = this.configService.getOrThrow<string>(
      'API_SECRET_CLEANUP_CRON',
    );
    cron.schedule(schedule, () => {
      void this.cleanup();
    });
  }

  /** 배치 실패는 서버 로그로만 남기고, 스케줄러 자체가 죽지 않도록 절대 throw하지 않는다. */
  private async cleanup(): Promise<void> {
    try {
      const gracePeriodDays = this.configService.getOrThrow<number>(
        'API_SECRET_GRACE_PERIOD_DAYS',
      );
      const { result } = await this.spExecutor.callProcedure(
        'SP_PROJECT_API_SECRET_CLEANUP',
        [gracePeriodDays],
      );
      if (result !== 0) {
        this.logger.error(
          `SP_PROJECT_API_SECRET_CLEANUP returned RESULT=${result}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `SP_PROJECT_API_SECRET_CLEANUP failed: ${(err as Error).message}`,
      );
    }
  }
}
