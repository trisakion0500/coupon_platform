import { config } from '../config';
import { appLogger } from '../logger';
import { CouponApiError } from '../sdk/CouponS2sClient';
import { recordUnconfirmedBacklog } from '../stats';
import { ScenarioContext, ScenarioRunResult } from './types';

/**
 * 6.6 보상지급 중단 재처리(리컨실리에이션) — 6.1이 confirm을 생략해 남긴 미컨슘 건을 게임서버
 * 스스로 나중에 조회해 재처리하는 흐름. 08_COUPON_USAGE_SCENARIO.md 3장이 정의한 "confirm이
 * 안 와도 쿠폰서버는 되돌리지 않고, 재처리 여부/시점 판단은 전적으로 게임서버 책임"이라는 설계를
 * 실제로 소비하는 유일한 시나리오다. 새 소모(reserve)를 만들지 않고 기존 미컨슘 건만
 * 조회/재처리하므로 6.3과 달리 DB 사후검증은 필요 없다(confirm은 상태를 바꾸지 않는 지급 결과
 * 기록일 뿐이라 동시 확정 문제 자체가 없다 — 20_COUPON_USAGE_API.md 2.2 Business Rules).
 */
export async function runReconcile(ctx: ScenarioContext): Promise<ScenarioRunResult[]> {
  const results: ScenarioRunResult[] = [];

  const unconfirmed = await ctx.client.getUnconfirmed({ page: 1, pageSize: 20 });
  const items = unconfirmed.items;
  const totalCount = 'total_count' in unconfirmed ? unconfirmed.total_count : items.length;
  recordUnconfirmedBacklog(totalCount);

  if (items.length === 0) {
    appLogger.info(`[reconcile] project=${ctx.campaign.project_id} 미컨슘 건 없음, 건너뜀`);
    return results;
  }

  let retried = 0;
  for (const item of items) {
    if (Math.random() >= config.reconcileRetryRatio) continue; // 이번엔 재처리 안 함(느린 재처리 재현)
    retried += 1;
    const started = Date.now();
    try {
      await ctx.client.confirm(item.code_value, item.game_user_id);
      results.push({ scenario: 'reconcile', resultCode: 0, elapsedMs: Date.now() - started });
      appLogger.info(
        `[reconcile] 재처리 성공 code=${item.code_value} user=${item.game_user_id} campaign=${item.coupon_campaign_id}`,
      );
    } catch (err) {
      if (!(err instanceof CouponApiError)) throw err;
      results.push({
        scenario: 'reconcile',
        resultCode: err.resultCode,
        elapsedMs: Date.now() - started,
      });
      appLogger.warn(
        `[reconcile] 재처리 실패 code=${item.code_value} user=${item.game_user_id} result=${err.resultCode}`,
      );
    }
  }

  appLogger.info(
    `[reconcile] project=${ctx.campaign.project_id} 미컨슘 잔존=${totalCount} 이번tick재처리시도=${retried}`,
  );

  return results;
}
