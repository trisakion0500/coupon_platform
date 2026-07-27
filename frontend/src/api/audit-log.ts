import { apiClient } from '@/api/client';
import type { ApiEnvelope, PaginatedResult } from '@/types/api';
import type {
  AuditLogDetail,
  AuditLogListItem,
  AuditLogListQuery,
} from '@/types/audit-log';

/** 15_LOG_AUDIT_API.md 5장 — DEVELOPER는 서버가 본인 소속 회사(+역할보유 프로젝트)로 스코핑. */
export async function listAuditLogs(
  query: AuditLogListQuery,
): Promise<PaginatedResult<AuditLogListItem>> {
  const { data } = await apiClient.get<ApiEnvelope<PaginatedResult<AuditLogListItem>>>(
    '/log-audits',
    { params: query },
  );
  return data.data;
}

/** 15_LOG_AUDIT_API.md 6장 — 범위 밖 idx는 20001(스코핑) 또는 31008(존재하지 않음). */
export async function getAuditLog(idx: number): Promise<AuditLogDetail> {
  const { data } = await apiClient.get<ApiEnvelope<AuditLogDetail>>(
    `/log-audits/${idx}`,
  );
  return data.data;
}
