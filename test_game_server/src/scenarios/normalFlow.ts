import { config } from '../config';
import { appLogger } from '../logger';
import { CouponApiError } from '../sdk/CouponS2sClient';
import { getUsableCodes } from '../testing/db/queries';
import { ScenarioContext, ScenarioRunResult } from './types';

/**
 * 6.1 정상 흐름 — reserve 성공 시 `CONFIRM_RATIO` 확률로 즉시 confirm(지급 완료 시뮬레이션),
 * 나머지 확률은 의도적으로 confirm을 생략한다 — 게임서버가 소모 확정 직후 보상 지급 처리 도중
 * 크래시/타임아웃/네트워크 단절로 confirm 콜백을 못 보내는 상황을 재현한 것이다. 이 미컨슘 건이
 * 6.6 리컨실리에이션 시나리오의 대상이 된다.
 */
export async function runNormalFlow(ctx: ScenarioContext): Promise<ScenarioRunResult[]> {
  const results: ScenarioRunResult[] = [];
  const codes = await getUsableCodes(ctx.campaign.coupon_campaign_id);
  if (codes.length === 0) {
    appLogger.info(`[normal] campaign=${ctx.campaign.coupon_campaign_id} 사용가능 코드 없음, 건너뜀`);
    return results;
  }

  const code = codes[Math.floor(Math.random() * codes.length)];
  const gameUserId = ctx.pickGameUserId();
  const started = Date.now();

  try {
    const reserved = await ctx.client.reserve(code.code_value, gameUserId);
    results.push({ scenario: 'normal', resultCode: 0, elapsedMs: Date.now() - started });
    appLogger.info(
      `[normal] reserve 성공 campaign=${ctx.campaign.coupon_campaign_id} code=${code.code_value} user=${gameUserId} usage_id=${reserved.coupon_code_usage_id}`,
    );

    ctx.history.record({
      client: ctx.client,
      projectId: ctx.campaign.project_id,
      couponCampaignId: ctx.campaign.coupon_campaign_id,
      codeValue: code.code_value,
      gameUserId,
      useLimitPerUser: ctx.campaign.use_limit_per_user,
      couponCodeUsageId: reserved.coupon_code_usage_id,
    });

    if (Math.random() < config.confirmRatio) {
      const confirmStarted = Date.now();
      await ctx.client.confirm(code.code_value, gameUserId);
      results.push({ scenario: 'normal', resultCode: 0, elapsedMs: Date.now() - confirmStarted });
      appLogger.info(`[normal] confirm 성공 usage_id=${reserved.coupon_code_usage_id}`);
    } else {
      appLogger.info(
        `[normal] confirm 생략(보상지급 중단 시뮬레이션) usage_id=${reserved.coupon_code_usage_id}`,
      );
    }
  } catch (err) {
    if (err instanceof CouponApiError) {
      results.push({
        scenario: 'normal',
        resultCode: err.resultCode,
        elapsedMs: Date.now() - started,
      });
      appLogger.warn(`[normal] reserve 실패 code=${code.code_value} result=${err.resultCode}`);
      return results;
    }
    throw err;
  }

  return results;
}
