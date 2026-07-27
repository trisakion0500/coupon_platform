import { CouponS2sClient } from '../sdk/CouponS2sClient';
import { ActiveCampaignRow } from '../testing/db/queries';

export type ScenarioName =
  | 'normal'
  | 'idempotent'
  | 'race'
  | 'exhausted'
  | 'reconcile'
  | 'error';

export interface ScenarioRunResult {
  scenario: ScenarioName;
  /** 0 = 성공. 그 외는 CouponApiError.resultCode. */
  resultCode: number;
  elapsedMs: number;
}

/** 6.1이 만든 성공 reserve 이력 — 6.2(멱등 재시도)가 재사용한다. */
export interface ReserveHistoryEntry {
  /** 원래 reserve 때 쓴 것과 동일한 client(같은 project 자격증명)를 그대로 재사용한다. */
  client: CouponS2sClient;
  projectId: number;
  couponCampaignId: number;
  codeValue: string;
  gameUserId: string;
  useLimitPerUser: number;
  couponCodeUsageId: number;
}

const MAX_HISTORY = 500;

export class ReserveHistoryStore {
  private entries: ReserveHistoryEntry[] = [];

  record(entry: ReserveHistoryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_HISTORY) this.entries.shift();
  }

  /** 멱등 재시도(6.2) 대상 — use_limit_per_user=1인 성공 건만 무작위로 고른다. */
  pickIdempotentCandidate(): ReserveHistoryEntry | undefined {
    const candidates = this.entries.filter((entry) => entry.useLimitPerUser === 1);
    if (candidates.length === 0) return undefined;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
}

export interface ScenarioContext {
  campaign: ActiveCampaignRow;
  client: CouponS2sClient;
  /** errorCases의 "필드 자체가 누락된 요청" 같은 SDK로 표현 못 하는 저수준 테스트 전용. */
  credentials: { baseUrl: string; apiKey: string; apiSecretPlain: string };
  pickGameUserId: () => string;
  history: ReserveHistoryStore;
}
