import { apiClient } from '@/api/client';
import type { ApiEnvelope } from '@/types/api';
import type { PublicConfig } from '@/types/config';

/** 10_API_COMMON.md 6.2 — 인증 불필요. */
export async function getPublicConfig(): Promise<PublicConfig> {
  const { data } = await apiClient.get<ApiEnvelope<PublicConfig>>(
    '/config/public',
  );
  return data.data;
}
