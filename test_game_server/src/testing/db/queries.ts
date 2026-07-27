import { RowDataPacket } from 'mysql2';
import { dbPool } from './pool';

/**
 * `CALL SPTG_*(...)`의 첫 번째 결과셋을 그대로 읽는다. 이 SP들은 RESULT 단일 컬럼 규약을 따르지
 * 않는 순수 조회다(docs/21_TEST_GAME_SERVER.md 10.1).
 */
async function callProcedure<T extends RowDataPacket>(
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const [rows] = await dbPool.query<T[][]>(sql, params);
  return rows[0] ?? [];
}

export interface ActiveCampaignRow extends RowDataPacket {
  coupon_campaign_id: number;
  project_id: number;
  name: string;
  code_type: number; // 1:RANDOM, 2:FIXED
  use_limit_per_user: number;
  usable_qty: number;
  used_qty: number;
  api_key: string;
  api_secret: string; // 암호문
  api_secret_prev: string | null; // 암호문
}

export function getActiveCampaigns(): Promise<ActiveCampaignRow[]> {
  return callProcedure<ActiveCampaignRow>('CALL SPTG_ACTIVE_CAMPAIGN_LIST()', []);
}

export interface UsableCodeRow extends RowDataPacket {
  coupon_code_id: number;
  code_value: string;
}

export function getUsableCodes(couponCampaignId: number): Promise<UsableCodeRow[]> {
  return callProcedure<UsableCodeRow>('CALL SPTG_USABLE_CODE_LIST(?)', [couponCampaignId]);
}

export interface ExhaustedRandomCodeRow extends RowDataPacket {
  coupon_code_id: number;
  project_id: number;
  coupon_campaign_id: number;
  code_value: string;
  api_key: string;
  api_secret: string; // 암호문
  api_secret_prev: string | null; // 암호문
}

export async function getExhaustedRandomCode(): Promise<ExhaustedRandomCodeRow | null> {
  const rows = await callProcedure<ExhaustedRandomCodeRow>(
    'CALL SPTG_EXHAUSTED_RANDOM_CODE()',
    [],
  );
  return rows[0] ?? null;
}

export interface ExhaustedFixedTargetRow extends RowDataPacket {
  coupon_campaign_id: number;
  game_user_id: string;
  code_value: string;
  project_id: number;
  api_key: string;
  api_secret: string; // 암호문
  api_secret_prev: string | null; // 암호문
}

export async function getExhaustedFixedTarget(): Promise<ExhaustedFixedTargetRow | null> {
  const rows = await callProcedure<ExhaustedFixedTargetRow>(
    'CALL SPTG_EXHAUSTED_FIXED_TARGET()',
    [],
  );
  return rows[0] ?? null;
}

interface UsageCountRow extends RowDataPacket {
  usage_count: number;
}

export async function getUsageCount(
  projectId: number,
  codeValue: string,
  gameUserId: string | null,
): Promise<number> {
  const rows = await callProcedure<UsageCountRow>('CALL SPTG_USAGE_COUNT(?, ?, ?)', [
    projectId,
    codeValue,
    gameUserId,
  ]);
  return rows[0]?.usage_count ?? 0;
}
