import type { PaginationQuery } from '@/types/api';

/** 15_LOG_AUDIT_API.md 2.1 — 감사 로그 대상 테이블. */
export type AuditTableName = 'company' | 'project' | 'user' | 'user_role';

/** 15_LOG_AUDIT_API.md 2.2 — 작업 유형. 10=CREATE, 20=UPDATE, 30=STATUS_CHANGE. */
export type AuditAction = 10 | 20 | 30;

/** 15_LOG_AUDIT_API.md 5장 GET /log-audits 응답 items 항목. */
export interface AuditLogListItem {
  idx: number;
  company_id: number | null;
  project_id: number | null;
  table_name: AuditTableName;
  target_id: string;
  target_name: string | null;
  action: AuditAction;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
}

/** 15_LOG_AUDIT_API.md 6장 GET /log-audits/{idx} 응답 — before_json/after_json 포함. */
export interface AuditLogDetail extends AuditLogListItem {
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown>;
}

/** 15_LOG_AUDIT_API.md 5장 쿼리 파라미터. 화면(SCR-040)은 테이블/작업유형/기간만 필터로 노출하고
 * 회사는 헤더의 전역 선택을 그대로 쓴다(17_SCREEN_LIST.md SCR-040). */
export interface AuditLogListQuery extends PaginationQuery {
  company_id?: number;
  project_id?: number;
  table_name?: AuditTableName;
  target_id?: string;
  action?: AuditAction;
  from_created_at?: string;
  to_created_at?: string;
}
