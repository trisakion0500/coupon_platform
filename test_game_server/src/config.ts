import { config as loadDotenv } from 'dotenv';
import * as path from 'path';

loadDotenv({ path: path.resolve(__dirname, '..', '.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[config] 필수 환경변수 누락: ${name}`);
  }
  return value;
}

function optionalNumber(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`[config] ${name}은 숫자여야 합니다 (현재: ${raw})`);
  }
  return value;
}

export interface ScenarioWeights {
  normal: number;
  idempotent: number;
  race: number;
  exhausted: number;
  reconcile: number;
  error: number;
}

export interface Config {
  db: { host: string; port: number; user: string; password: string; database: string };
  encryptionKey: string;
  couponServerBaseUrl: string;
  tickIntervalMs: number;
  gameUserPoolSize: number;
  confirmRatio: number;
  raceBurstCount: number;
  reconcileRetryRatio: number;
  scenarioWeights: ScenarioWeights;
}

const scenarioWeights: ScenarioWeights = {
  normal: optionalNumber('SCENARIO_WEIGHT_NORMAL', 60),
  idempotent: optionalNumber('SCENARIO_WEIGHT_IDEMPOTENT', 10),
  race: optionalNumber('SCENARIO_WEIGHT_RACE', 10),
  exhausted: optionalNumber('SCENARIO_WEIGHT_EXHAUSTED', 5),
  reconcile: optionalNumber('SCENARIO_WEIGHT_RECONCILE', 10),
  error: optionalNumber('SCENARIO_WEIGHT_ERROR', 5),
};

// docs/20_TEST_GAME_SERVER.md 4장 — 가중치 6개 합은 반드시 100이어야 하며, 조용히 정규화하지 않고
// 즉시 종료한다.
const weightSum = Object.values(scenarioWeights).reduce((sum, value) => sum + value, 0);
if (weightSum !== 100) {
  throw new Error(
    `[config] 시나리오 가중치 합은 100이어야 합니다 (현재 ${weightSum}: ${JSON.stringify(scenarioWeights)})`,
  );
}

export const config: Config = {
  db: {
    host: required('DB_HOST'),
    port: optionalNumber('DB_PORT', 3306),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME'),
  },
  encryptionKey: required('ENCRYPTION_KEY'),
  couponServerBaseUrl: required('COUPON_SERVER_BASE_URL'),
  tickIntervalMs: optionalNumber('TICK_INTERVAL_MS', 5000),
  gameUserPoolSize: optionalNumber('GAME_USER_POOL_SIZE', 50),
  confirmRatio: optionalNumber('CONFIRM_RATIO', 0.9),
  raceBurstCount: optionalNumber('RACE_BURST_COUNT', 5),
  reconcileRetryRatio: optionalNumber('RECONCILE_RETRY_RATIO', 0.5),
  scenarioWeights,
};
