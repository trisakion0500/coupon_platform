import { config } from '../config';
import { appLogger, mismatchLogger } from '../logger';
import { CouponApiError } from '../sdk/CouponS2sClient';
import { getUsableCodes, getUsageCount } from '../testing/db/queries';
import { isRateLimited } from './rateLimit';
import { ScenarioContext, ScenarioRunResult } from './types';

/**
 * 6.3 동시성 레이스 — 아직 소모되지 않은 코드를 하나 골라 Promise.all로 RACE_BURST_COUNT개의
 * reserve를 동시에 쏜다. RANDOM은 서로 다른 game_user_id로 경쟁시켜 정확히 1건만 성공하는지,
 * FIXED(limit=1)는 같은 game_user_id로 동시 재시도시켜 전부 동일 usage_id로 수렴하는지(멱등),
 * FIXED(limit>1)는 min(N, limit)건만 성공하는지 검증한다. 버스트 종료 후 DB(SPTG_USAGE_COUNT)로
 * 실제 coupon_code_usage 행 수까지 재확인한다 — HTTP 응답 분포만으로는 못 잡는 이중 확정을 잡는다.
 */
export async function runConcurrencyRace(ctx: ScenarioContext): Promise<ScenarioRunResult[]> {
  const codes = await getUsableCodes(ctx.campaign.coupon_campaign_id);
  if (codes.length === 0) {
    appLogger.info(`[race] campaign=${ctx.campaign.coupon_campaign_id} 사용가능 코드 없음, 건너뜀`);
    return [];
  }

  const code = codes[Math.floor(Math.random() * codes.length)];
  const n = config.raceBurstCount;
  const isFixed = ctx.campaign.code_type === 2;

  let gameUserIds: string[];
  let expectedSuccessCount: number;
  let usageCountUserFilter: string | null;
  const isFixedLimitOne = isFixed && ctx.campaign.use_limit_per_user === 1;

  if (!isFixed) {
    // RANDOM 코드 동시 소모 경쟁 — 서로 다른 game_user_id N개
    const uniquePrefix = `race_random_${Date.now()}`;
    gameUserIds = Array.from({ length: n }, (_, i) => `${uniquePrefix}_${i}`);
    expectedSuccessCount = 1;
    usageCountUserFilter = null;
  } else {
    // FIXED 코드 동일 유저 동시 시도 — 같은 game_user_id N개
    const gameUserId = `race_fixed_${Date.now()}`;
    gameUserIds = Array.from({ length: n }, () => gameUserId);
    expectedSuccessCount = isFixedLimitOne ? 1 : Math.min(n, ctx.campaign.use_limit_per_user);
    usageCountUserFilter = gameUserId;
  }

  const started = Date.now();
  const settled = await Promise.allSettled(
    gameUserIds.map((gameUserId) => ctx.client.reserve(code.code_value, gameUserId)),
  );
  const elapsedMs = Date.now() - started;

  const results: ScenarioRunResult[] = [];
  const successUsageIds = new Set<number>();
  let successCount = 0;
  let rateLimited = false;

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      successCount += 1;
      successUsageIds.add(outcome.value.coupon_code_usage_id);
      results.push({ scenario: 'race', resultCode: 0, elapsedMs });
    } else if (outcome.reason instanceof CouponApiError) {
      results.push({ scenario: 'race', resultCode: outcome.reason.resultCode, elapsedMs });
      if (isRateLimited(outcome.reason.resultCode)) rateLimited = true;
    } else {
      throw outcome.reason;
    }
  }

  if (rateLimited) {
    // 버스트 중 일부가 외부 스로틀링(40001)에 걸리면 나머지 응답 분포가 순수 동시성 결과를
    // 반영하지 않으므로, 이번 버스트는 사후검증(성공건수/DB) 자체를 건너뛴다 — 오탐 방지.
    appLogger.info(
      `[race] 버스트 중 레이트리밋(40001) 발생, 이번 버스트 사후검증 스킵 code=${code.code_value}`,
    );
    return results;
  }

  if (isFixedLimitOne) {
    if (successUsageIds.size > 1) {
      mismatchLogger.warn(
        `[race] MISMATCH FIXED(limit=1) 동시 재시도가 서로 다른 usage_id로 수렴 code=${code.code_value} ids=${[...successUsageIds].join(',')}`,
      );
    }
  } else if (successCount !== expectedSuccessCount) {
    mismatchLogger.warn(
      `[race] MISMATCH 성공 건수 불일치 variant=${isFixed ? 'fixed' : 'random'} expected=${expectedSuccessCount} actual=${successCount} code=${code.code_value}`,
    );
  }

  const dbCount = await getUsageCount(ctx.campaign.project_id, code.code_value, usageCountUserFilter);
  const expectedDbCount = isFixedLimitOne ? 1 : expectedSuccessCount;
  if (dbCount !== expectedDbCount) {
    mismatchLogger.warn(
      `[race] MISMATCH DB 사후검증 실패 code=${code.code_value} expected=${expectedDbCount} actual=${dbCount}`,
    );
  } else {
    appLogger.info(
      `[race] 버스트 완료 code=${code.code_value} n=${n} success=${successCount} db검증=OK(${dbCount})`,
    );
  }

  return results;
}
