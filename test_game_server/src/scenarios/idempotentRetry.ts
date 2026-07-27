import { appLogger, mismatchLogger } from '../logger';
import { CouponApiError } from '../sdk/CouponS2sClient';
import { isRateLimited } from './rateLimit';
import { ScenarioContext, ScenarioRunResult } from './types';

/**
 * 6.2 멱등 재시도 — 6.1이 기록해둔 이력 중 use_limit_per_user=1인 성공 건을 골라 동일한
 * 코드+동일한 game_user_id로 reserve/confirm을 다시 호출한다. 18_COUPON_USAGE_API.md 2.1의
 * 멱등 규칙에 따라 새 소모를 만들지 않고 최초 성공 응답과 동일한 coupon_code_usage_id가
 * 돌아와야 한다 — 원래 reserve 때와 동일한 client(같은 project 자격증명)를 재사용한다.
 */
export async function runIdempotentRetry(ctx: ScenarioContext): Promise<ScenarioRunResult[]> {
  const results: ScenarioRunResult[] = [];
  const candidate = ctx.history.pickIdempotentCandidate();
  if (!candidate) {
    appLogger.info('[idempotent] 재시도할 이력 없음, 건너뜀');
    return results;
  }

  const started = Date.now();
  try {
    const reserved = await candidate.client.reserve(candidate.codeValue, candidate.gameUserId);
    results.push({ scenario: 'idempotent', resultCode: 0, elapsedMs: Date.now() - started });

    if (reserved.coupon_code_usage_id !== candidate.couponCodeUsageId) {
      mismatchLogger.warn(
        `[idempotent] MISMATCH reserve usage_id 불일치 expected=${candidate.couponCodeUsageId} actual=${reserved.coupon_code_usage_id} code=${candidate.codeValue} user=${candidate.gameUserId}`,
      );
    } else {
      appLogger.info(`[idempotent] reserve 재시도 멱등 확인 usage_id=${reserved.coupon_code_usage_id}`);
    }
  } catch (err) {
    if (err instanceof CouponApiError) {
      results.push({
        scenario: 'idempotent',
        resultCode: err.resultCode,
        elapsedMs: Date.now() - started,
      });
      if (isRateLimited(err.resultCode)) {
        appLogger.info('[idempotent] reserve 재시도 레이트리밋(40001)으로 스킵');
      } else {
        mismatchLogger.warn(
          `[idempotent] MISMATCH 멱등이어야 할 reserve 재시도가 에러 반환 result=${err.resultCode} code=${candidate.codeValue} user=${candidate.gameUserId}`,
        );
      }
    } else {
      throw err;
    }
    return results;
  }

  const confirmStarted = Date.now();
  try {
    const confirmed = await candidate.client.confirm(candidate.codeValue, candidate.gameUserId);
    results.push({ scenario: 'idempotent', resultCode: 0, elapsedMs: Date.now() - confirmStarted });
    if (confirmed.coupon_code_usage_id !== candidate.couponCodeUsageId) {
      mismatchLogger.warn(
        `[idempotent] MISMATCH confirm usage_id 불일치 expected=${candidate.couponCodeUsageId} actual=${confirmed.coupon_code_usage_id}`,
      );
    }
  } catch (err) {
    if (err instanceof CouponApiError) {
      results.push({
        scenario: 'idempotent',
        resultCode: err.resultCode,
        elapsedMs: Date.now() - confirmStarted,
      });
      if (isRateLimited(err.resultCode)) {
        appLogger.info('[idempotent] confirm 재시도 레이트리밋(40001)으로 스킵');
      } else {
        // confirm은 상태 불변이라 여러 번 호출돼도 무해해야 한다(18_COUPON_USAGE_API.md 2.2) — 에러면 이상.
        mismatchLogger.warn(
          `[idempotent] MISMATCH confirm 재시도가 에러 반환 result=${err.resultCode} usage_id=${candidate.couponCodeUsageId}`,
        );
      }
    } else {
      throw err;
    }
  }

  return results;
}
