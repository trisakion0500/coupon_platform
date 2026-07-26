import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { LogSpExecutorService } from '../database/log-sp-executor.service';
import { SpExecutorService } from '../database/sp-executor.service';

/** SP_CAMPAIGN_EXPIRE 반환 행 — coupon_campaign 전체 컬럼(종료 처리 후 최종 상태). */
interface ExpiredCampaignRow {
  coupon_campaign_id: number;
  project_id: number;
  name: string;
  campaign_start: string;
  campaign_end: string;
  code_type: number;
  use_hyphen: number;
  requested_qty: number;
  generated_qty: number;
  generation_status: number;
  generation_error: string | null;
  usable_qty: number;
  used_qty: number;
  use_limit_per_user: number;
  status: number;
  approval_status: number;
  approved_by: number | null;
  approved_at: string | null;
  reject_reason: string | null;
  reward_data: Record<string, unknown>;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
  edit_count: number;
}

/** log_coupon_campaign 작업유형(04_DATABASE_SCHEMA.md 10장) — STATUS_CHANGE. */
const STATUS_CHANGE_ACTION = 30;

/**
 * 실제 user_id는 1부터 시작하는 AUTO_INCREMENT라 0은 안전한 sentinel이다 — 이 프로젝트 최초의
 * "시스템이 수행한 액션" 로그 컨벤션(02_DEV_CONVENTIONS.md 4.2, SP_CAMPAIGN_EXPIRE 헤더 주석 참고).
 */
const SYSTEM_ACTOR_USER_ID = 0;
const SYSTEM_ACTOR_NAME = 'SYSTEM';

/**
 * 사용기간이 지난 활성(`status=2`) 캠페인을 자동으로 종료(`status=4`) 처리하는 배치
 * (2026-07-25) — `SP_CAMPAIGN_EXPIRE`가 대상 판정과 상태 전환을 원자적으로 처리하고, 이
 * 서비스는 크론 등록 + 반환된 각 행을 `log_coupon_campaign`에 STATUS_CHANGE로 기록하는
 * 역할만 한다. 다른 크론(`NonceCleanupService` 등)과 동일하게 `runExclusive`로 감싸
 * 스케일아웃 환경에서 레플리카 여러 대가 같은 배치를 중복 실행하지 않게 한다
 * (02_DEV_CONVENTIONS.md 4.1).
 *
 * @author trisakion
 */
@Injectable()
export class CampaignExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignExpiryService.name);
  private task: ScheduledTask | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly spExecutor: SpExecutorService,
    private readonly logSpExecutor: LogSpExecutorService,
  ) {}

  /** 서버 기동 시 크론 스케줄을 등록한다. */
  onModuleInit(): void {
    const schedule = this.configService.getOrThrow<string>(
      'CAMPAIGN_EXPIRY_CRON',
    );
    this.task = cron.schedule(schedule, () => {
      void this.expire();
    });
  }

  /** 서버 정상 종료 시 크론 스케줄을 멈춘다(`SessionCleanupService`와 동일 이유). */
  async onModuleDestroy(): Promise<void> {
    await this.task?.stop();
  }

  /**
   * 배치 실패는 서버 로그로만 남기고, 스케줄러 자체가 죽지 않도록 절대 throw하지 않는다.
   */
  private async expire(): Promise<void> {
    try {
      const ran = await this.spExecutor.runExclusive(
        'coupon_platform:campaign_expiry',
        async () => {
          const { result, data } =
            await this.spExecutor.callProcedure<ExpiredCampaignRow[]>(
              'SP_CAMPAIGN_EXPIRE',
            );

          if (result !== 0) {
            this.logger.error(`SP_CAMPAIGN_EXPIRE returned RESULT=${result}`);
            return;
          }

          for (const row of data ?? []) {
            this.logger.log(
              `campaign ${row.coupon_campaign_id} (project ${row.project_id}) auto-expired ` +
                `— campaign_end=${row.campaign_end} already passed`,
            );
            await this.logExpiry(row);
          }
        },
      );

      if (!ran) {
        this.logger.debug(
          'SP_CAMPAIGN_EXPIRE skipped — another instance is already running it',
        );
      }
    } catch (err) {
      this.logger.error(`SP_CAMPAIGN_EXPIRE failed: ${(err as Error).message}`);
    }
  }

  /**
   * log_coupon_campaign 적재 — CampaignService의 도메인 SP 호출용 로그 헬퍼와 달리 실제 요청자
   * (JWT `user_id`)가 없는 배치 컨텍스트라, 여기서는 SYSTEM sentinel을 직접 채운다. 실패는
   * `logCall`이 삼켜 배치 자체에 영향을 주지 않는다(02_DEV_CONVENTIONS.md 1장).
   */
  private async logExpiry(row: ExpiredCampaignRow): Promise<void> {
    await this.logSpExecutor.logCall('SP_LOG_COUPON_CAMPAIGN_CREATE', [
      STATUS_CHANGE_ACTION,
      row.coupon_campaign_id,
      row.project_id,
      row.name,
      row.campaign_start,
      row.campaign_end,
      row.code_type,
      row.use_hyphen,
      row.requested_qty,
      row.generated_qty,
      row.usable_qty,
      row.used_qty,
      row.use_limit_per_user,
      row.status,
      row.approval_status,
      row.approved_by,
      row.approved_at,
      row.reject_reason,
      JSON.stringify(row.reward_data),
      SYSTEM_ACTOR_USER_ID,
      SYSTEM_ACTOR_NAME,
    ]);
  }
}
