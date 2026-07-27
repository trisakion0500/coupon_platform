import { apiClient } from '@/api/client';
import type { ApiEnvelope } from '@/types/api';
import type { HealthCheck } from '@/types/health';

/** 10_API_COMMON.md 6.1 — 인증 불필요. */
export async function getHealth(): Promise<HealthCheck> {
  const { data } = await apiClient.get<ApiEnvelope<HealthCheck>>('/health');
  return data.data;
}
