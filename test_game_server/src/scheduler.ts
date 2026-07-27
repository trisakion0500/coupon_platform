import { config, ScenarioWeights } from './config';
import { appLogger } from './logger';
import { CouponS2sClient } from './sdk/CouponS2sClient';
import { getActiveCampaigns } from './testing/db/queries';
import { decryptProjectSecret } from './testing/decryptProjectSecret';
import { runConcurrencyRace } from './scenarios/concurrencyRace';
import { runErrorCases } from './scenarios/errorCases';
import { runExhaustedRetry } from './scenarios/exhaustedRetry';
import { runIdempotentRetry } from './scenarios/idempotentRetry';
import { runNormalFlow } from './scenarios/normalFlow';
import { runReconcile } from './scenarios/reconcile';
import { ReserveHistoryStore, ScenarioContext, ScenarioName, ScenarioRunResult } from './scenarios/types';
import * as stats from './stats';

const history = new ReserveHistoryStore();

const gameUserPool: string[] = Array.from(
  { length: config.gameUserPoolSize },
  (_, i) => `test_game_server_player_${i}`,
);

function pickGameUserId(): string {
  return gameUserPool[Math.floor(Math.random() * gameUserPool.length)];
}

/** 4장 가중치 기준 무작위 시나리오 선택 — config.ts가 이미 합=100을 검증해뒀다. */
function pickScenario(weights: ScenarioWeights): ScenarioName {
  const entries: [ScenarioName, number][] = [
    ['normal', weights.normal],
    ['idempotent', weights.idempotent],
    ['race', weights.race],
    ['exhausted', weights.exhausted],
    ['reconcile', weights.reconcile],
    ['error', weights.error],
  ];
  let roll = Math.random() * 100;
  for (const [name, weight] of entries) {
    if (roll < weight) return name;
    roll -= weight;
  }
  return entries[entries.length - 1][0]; // 부동소수점 오차 안전망
}

async function runScenario(name: ScenarioName, ctx: ScenarioContext): Promise<ScenarioRunResult[]> {
  switch (name) {
    case 'normal':
      return runNormalFlow(ctx);
    case 'idempotent':
      return runIdempotentRetry(ctx);
    case 'race':
      return runConcurrencyRace(ctx);
    case 'exhausted':
      return runExhaustedRetry();
    case 'reconcile':
      return runReconcile(ctx);
    case 'error':
      return runErrorCases(ctx);
  }
}

async function tick(): Promise<void> {
  const campaigns = await getActiveCampaigns();
  if (campaigns.length === 0) {
    appLogger.warn('활성 캠페인 없음 — 관리 콘솔에서 캠페인을 활성화하고 코드를 발급해야 한다');
    return;
  }

  const campaign = campaigns[Math.floor(Math.random() * campaigns.length)];
  const client = new CouponS2sClient({
    baseUrl: config.couponServerBaseUrl,
    apiKey: campaign.api_key,
    apiSecret: decryptProjectSecret(campaign.api_secret),
  });

  const ctx: ScenarioContext = {
    campaign,
    client,
    credentials: {
      baseUrl: config.couponServerBaseUrl,
      apiKey: campaign.api_key,
      apiSecretPlain: decryptProjectSecret(campaign.api_secret),
    },
    pickGameUserId,
    history,
  };

  const scenario = pickScenario(config.scenarioWeights);
  try {
    const results = await runScenario(scenario, ctx);
    stats.record(results);
  } catch (err) {
    appLogger.error(`[${scenario}] 예상치 못한 예외 campaign=${campaign.coupon_campaign_id}`, err);
  }

  stats.onTickComplete();
}

let timer: NodeJS.Timeout | undefined;
let stopping = false;
let inFlight: Promise<void> = Promise.resolve();

/** docs/20_TEST_GAME_SERVER.md 2.1 — 상시 실행 데몬. tick 사이 간격은 TICK_INTERVAL_MS. */
export function startScheduler(): void {
  const loop = (): void => {
    if (stopping) return;
    inFlight = tick()
      .catch((err) => appLogger.error('tick 처리 중 예외', err))
      .finally(() => {
        if (!stopping) timer = setTimeout(loop, config.tickIntervalMs);
      });
  };
  loop();
}

/** SIGINT/SIGTERM 시 진행 중인 tick만 마무리하고 타이머를 멈춘다(2.1 그레이스풀 셧다운). */
export async function stopScheduler(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  await inFlight;
}
