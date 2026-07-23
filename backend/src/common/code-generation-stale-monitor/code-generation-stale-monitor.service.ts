import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cron from 'node-cron';
import { computeCodeGenerationStaleThresholdSec } from '../config/code-generation-stale-threshold.util';
import { SpExecutorService } from '../database/sp-executor.service';
import { getCodeGenerationStaleLogger } from '../logging/log4js-logger.service';

/** SP_CAMPAIGN_CODE_GENERATION_STALE_LIST 반환 행. */
interface StaleGenerationRow {
  coupon_campaign_id: number;
  project_id: number;
  code_type: number;
  generated_qty: number;
  requested_qty: number;
  updated_at: string;
}

/**
 * 정체된(`generation_status=2`) 코드생성 job **감지 전용** 모니터링 크론(스케일아웃 점검 5번,
 * 2026-07-23). 백그라운드 대량생성 루프는 순수 인메모리 fire-and-forget이라 담당 인스턴스가
 * 배포/재시작되면 job이 끊긴다(05_COUPON_ISSUANCE_SCENARIO.md 2.4) — 복구(`POST /codes/abort`
 * + 재시도)는 이미 DB 상태 기반이라 어느 인스턴스가 처리해도 안전하지만, 지금까지는 "정체됐다는
 * 사실을 누군가 알아채는" 과정 자체가 관리자가 화면을 보다가 우연히 발견하는 수동 방식이었다.
 * 스케일아웃 환경은 롤링 배포가 잦아 이 상황이 더 자주 생기므로, 감지만 자동화해 서버 로그로
 * 경고를 남긴다.
 *
 * **의도적으로 감지만 한다 — 자동 복구(abort/재시도)는 하지 않는다.** `SP_CAMPAIGN_CODE_ABORT`가
 * "관리자가 요청해도 최소한의 근거를 SP가 재확인하고, 시스템이 스스로 포기 선언하지 않는다"는
 * 원칙으로 설계됐고(그 SP 헤더 주석 참고), 이 원칙은 자동 워치독 방향을 검토했다가 사용자가
 * 명시적으로 기각하고 수동 복구를 택한 결정이다 — 이 모니터는 그 결정을 뒤집지 않고, 감지
 * 단계에서 발견하기 어려웠던 부분만 보완한다.
 *
 * @author trisakion
 */
@Injectable()
export class CodeGenerationStaleMonitorService implements OnModuleInit {
  // 일반 NestJS Logger(-> app.log)가 아니라 전용 카테고리(logs/code-generation-stale.log)로
  // 직접 로깅한다 — 운영자가 액션을 취해야 하는 경고라 일반 앱 로그와 분리해 별도로
  // tail/알림 연동할 수 있게 한다(2026-07-23, 스케일아웃 점검 5번 후속).
  private readonly logger = getCodeGenerationStaleLogger();

  private readonly maxGenerationDbRetries: number;
  private readonly generationRetryBaseDelayMs: number;
  private readonly abortStaleSafetyMultiplier: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly spExecutor: SpExecutorService,
  ) {
    this.maxGenerationDbRetries = configService.getOrThrow<number>(
      'CODE_GENERATION_MAX_DB_RETRIES',
    );
    this.generationRetryBaseDelayMs = configService.getOrThrow<number>(
      'CODE_GENERATION_RETRY_BASE_DELAY_MS',
    );
    this.abortStaleSafetyMultiplier = configService.getOrThrow<number>(
      'CODE_GENERATION_ABORT_STALE_SAFETY_MULTIPLIER',
    );
  }

  /** 서버 기동 시 크론 스케줄을 등록한다. */
  onModuleInit(): void {
    const schedule = this.configService.getOrThrow<string>(
      'CODE_GENERATION_STALE_MONITOR_CRON',
    );
    cron.schedule(schedule, () => {
      void this.check();
    });
  }

  /**
   * 배치 실패는 서버 로그로만 남기고, 스케줄러 자체가 죽지 않도록 절대 throw하지 않는다.
   * `runExclusive`로 감싸 스케일아웃 시 레플리카 여러 대가 같은 정체 job을 중복으로 경고 로그에
   * 찍지 않도록 한다(`02_DEV_CONVENTIONS.md` 4.1).
   */
  private async check(): Promise<void> {
    try {
      const staleSeconds = computeCodeGenerationStaleThresholdSec({
        maxDbRetries: this.maxGenerationDbRetries,
        retryBaseDelayMs: this.generationRetryBaseDelayMs,
        staleSafetyMultiplier: this.abortStaleSafetyMultiplier,
      });

      await this.spExecutor.runExclusive(
        'coupon_platform:code_generation_stale_monitor',
        async () => {
          const { result, data } = await this.spExecutor.callProcedure<
            StaleGenerationRow[]
          >('SP_CAMPAIGN_CODE_GENERATION_STALE_LIST', [staleSeconds]);

          if (result !== 0) {
            this.logger.error(
              `SP_CAMPAIGN_CODE_GENERATION_STALE_LIST returned RESULT=${result}`,
            );
            return;
          }

          for (const row of data ?? []) {
            this.logger.warn(
              `campaign ${row.coupon_campaign_id} (project ${row.project_id}) code generation ` +
                `appears stale — generation_status=2 since ${row.updated_at} ` +
                `(${row.generated_qty}/${row.requested_qty} generated). ` +
                `Admin action required: POST /campaigns/${row.coupon_campaign_id}/codes/abort, then retry.`,
            );
          }
        },
      );
    } catch (err) {
      this.logger.error(
        `SP_CAMPAIGN_CODE_GENERATION_STALE_LIST failed: ${(err as Error).message}`,
      );
    }
  }
}
