import { createHmac, randomUUID } from 'crypto';
import { appLogger, mismatchLogger } from '../logger';
import { CouponApiError } from '../sdk/CouponS2sClient';
import { getUsableCodes } from '../testing/db/queries';
import { isRateLimited } from './rateLimit';
import { ScenarioContext, ScenarioRunResult } from './types';

/**
 * 6.5 에러 케이스 — 존재하지 않는 코드로 reserve(31005), reserve 이력 없이 confirm(31006),
 * game_user_id 필드 자체가 누락된 요청(30001)을 검증한다. 마지막 케이스는
 * `CouponS2sClient`(입점사에 그대로 제공하는 SDK, docs/20_TEST_GAME_SERVER.md 9장)가 항상
 * 올바른 타입의 인자를 받도록 설계돼 있어 "필드 자체가 없는 요청"을 표현할 수 없다 — 그래서 이
 * 파일(테스트 전용 계층)이 SDK를 거치지 않고 최소한의 서명 로직을 직접 구현해 raw 요청을 보낸다.
 * SDK의 공개 표면을 이 테스트 목적 하나 때문에 넓히지 않기 위한 의도적인 선택이다.
 */
export async function runErrorCases(ctx: ScenarioContext): Promise<ScenarioRunResult[]> {
  const results: ScenarioRunResult[] = [];

  await expectError(
    results,
    '존재하지 않는 코드로 reserve',
    () => ctx.client.reserve(`NO_SUCH_CODE_${randomUUID()}`, ctx.pickGameUserId()),
    31005,
  );

  const codes = await getUsableCodes(ctx.campaign.coupon_campaign_id);
  if (codes.length > 0) {
    await expectError(
      results,
      'reserve 없이 confirm',
      () => ctx.client.confirm(codes[0].code_value, `never_reserved_${randomUUID()}`),
      31006,
    );

    await expectMissingGameUserId(ctx, codes[0].code_value, results);
  }

  return results;
}

async function expectError(
  results: ScenarioRunResult[],
  label: string,
  action: () => Promise<unknown>,
  expectedResultCode: number,
): Promise<void> {
  const started = Date.now();
  try {
    await action();
    results.push({ scenario: 'error', resultCode: 0, elapsedMs: Date.now() - started });
    mismatchLogger.warn(`[error] MISMATCH ${label}이(가) 성공해버림(${expectedResultCode} 기대)`);
  } catch (err) {
    if (!(err instanceof CouponApiError)) throw err;
    results.push({ scenario: 'error', resultCode: err.resultCode, elapsedMs: Date.now() - started });
    if (isRateLimited(err.resultCode)) {
      appLogger.info(`[error] ${label} 레이트리밋(40001)으로 스킵`);
    } else if (err.resultCode !== expectedResultCode) {
      mismatchLogger.warn(
        `[error] MISMATCH ${label} 기대 result=${expectedResultCode} actual=${err.resultCode}`,
      );
    } else {
      appLogger.info(`[error] ${label} 예상대로 ${err.resultCode}`);
    }
  }
}

/** `X-API-Signature`가 `S2sAuthGuard.buildStringToSign`과 동일 규칙으로 계산돼야 서명 검증을 통과한다. */
async function expectMissingGameUserId(
  ctx: ScenarioContext,
  codeValue: string,
  results: ScenarioRunResult[],
): Promise<void> {
  const method = 'POST';
  const path = `/v1/coupons/${encodeURIComponent(codeValue)}/reserve`;
  const bodyString = '{}'; // game_user_id 필드 자체를 누락
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const stringToSign = [method, path, '', timestamp, nonce, bodyString].join('\n');
  const signature = createHmac('sha256', ctx.credentials.apiSecretPlain)
    .update(stringToSign)
    .digest('hex');

  const started = Date.now();
  const response = await fetch(`${ctx.credentials.baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': ctx.credentials.apiKey,
      'X-API-Timestamp': timestamp,
      'X-API-Nonce': nonce,
      'X-API-Signature': signature,
    },
    body: bodyString,
  });
  const json = (await response.json()) as { result: number };
  results.push({ scenario: 'error', resultCode: json.result, elapsedMs: Date.now() - started });

  if (isRateLimited(json.result)) {
    appLogger.info('[error] game_user_id 누락 레이트리밋(40001)으로 스킵');
  } else if (json.result !== 30001) {
    mismatchLogger.warn(`[error] MISMATCH game_user_id 누락 기대 result=30001 actual=${json.result}`);
  } else {
    appLogger.info('[error] game_user_id 누락 예상대로 30001');
  }
}
