import { config } from '../config';
import { appLogger, mismatchLogger } from '../logger';
import { CouponApiError, CouponS2sClient } from '../sdk/CouponS2sClient';
import {
  ExhaustedFixedTargetRow,
  ExhaustedRandomCodeRow,
  getExhaustedFixedTarget,
  getExhaustedRandomCode,
} from '../testing/db/queries';
import { decryptProjectSecret } from '../testing/decryptProjectSecret';
import { isRateLimited } from './rateLimit';
import { ScenarioRunResult } from './types';

/**
 * 6.4 이미 소진된 쿠폰 재시도 — DB 전체에서 이미 소모 완료된 대상을 스스로 찾아 재시도한다
 * (6.1~6.3이 이번 tick에 우연히 고른 캠페인과 무관하게, 그 사이 다른 액터가 소모시킨 것까지
 * 포함). 대상 프로젝트가 현재 선택된 캠페인(ScenarioContext.campaign)의 프로젝트와 다를 수
 * 있으므로, SP가 함께 반환하는 credentials로 그때그때 새 CouponS2sClient를 만든다 —
 * ScenarioContext.client를 재사용하지 않는다.
 */
export async function runExhaustedRetry(): Promise<ScenarioRunResult[]> {
  return Math.random() < 0.5 ? runRandomVariant() : runFixedVariant();
}

function buildClient(target: { api_key: string; api_secret: string }): CouponS2sClient {
  return new CouponS2sClient({
    baseUrl: config.couponServerBaseUrl,
    apiKey: target.api_key,
    apiSecret: decryptProjectSecret(target.api_secret),
  });
}

async function runRandomVariant(): Promise<ScenarioRunResult[]> {
  const target: ExhaustedRandomCodeRow | null = await getExhaustedRandomCode();
  if (!target) {
    appLogger.info('[exhausted] 이미 소진된 RANDOM 코드 없음, 건너뜀');
    return [];
  }

  const client = buildClient(target);
  const started = Date.now();
  try {
    await client.reserve(target.code_value, `exhausted_retry_${Date.now()}`);
    mismatchLogger.warn(
      `[exhausted] MISMATCH 이미 소모된 RANDOM 코드 재시도가 성공해버림 code=${target.code_value}`,
    );
    return [{ scenario: 'exhausted', resultCode: 0, elapsedMs: Date.now() - started }];
  } catch (err) {
    if (!(err instanceof CouponApiError)) throw err;
    const elapsedMs = Date.now() - started;
    if (isRateLimited(err.resultCode)) {
      appLogger.info('[exhausted] RANDOM 재시도 레이트리밋(40001)으로 스킵');
    } else if (err.resultCode !== 33001) {
      mismatchLogger.warn(
        `[exhausted] MISMATCH RANDOM 재시도 기대 result=33001 actual=${err.resultCode} code=${target.code_value}`,
      );
    } else {
      appLogger.info(`[exhausted] RANDOM 재시도 예상대로 33001 code=${target.code_value}`);
    }
    return [{ scenario: 'exhausted', resultCode: err.resultCode, elapsedMs }];
  }
}

async function runFixedVariant(): Promise<ScenarioRunResult[]> {
  const target: ExhaustedFixedTargetRow | null = await getExhaustedFixedTarget();
  if (!target) {
    appLogger.info('[exhausted] 한도초과 FIXED 대상 없음, 건너뜀');
    return [];
  }

  const client = buildClient(target);
  const started = Date.now();
  try {
    await client.reserve(target.code_value, target.game_user_id);
    mismatchLogger.warn(
      `[exhausted] MISMATCH 한도초과 FIXED 재시도가 성공해버림 code=${target.code_value} user=${target.game_user_id}`,
    );
    return [{ scenario: 'exhausted', resultCode: 0, elapsedMs: Date.now() - started }];
  } catch (err) {
    if (!(err instanceof CouponApiError)) throw err;
    const elapsedMs = Date.now() - started;
    if (isRateLimited(err.resultCode)) {
      appLogger.info('[exhausted] FIXED 한도초과 재시도 레이트리밋(40001)으로 스킵');
    } else if (err.resultCode !== 33003) {
      mismatchLogger.warn(
        `[exhausted] MISMATCH FIXED 한도초과 재시도 기대 result=33003 actual=${err.resultCode} code=${target.code_value}`,
      );
    } else {
      appLogger.info(`[exhausted] FIXED 한도초과 재시도 예상대로 33003 code=${target.code_value}`);
    }
    return [{ scenario: 'exhausted', resultCode: err.resultCode, elapsedMs }];
  }
}
