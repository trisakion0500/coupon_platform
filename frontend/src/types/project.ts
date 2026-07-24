import type { PaginationQuery } from '@/types/api';

/** 11_PROJECT_API.md 2장 — `project` 원본 컬럼 + company 조인. status: 1=사용, 0=중지. */
export interface Project {
  project_id: number;
  company_id: number;
  company_code: string;
  company_name: string;
  project_code: string;
  project_name: string;
  api_key: string;
  description: string | null;
  status: number;
  secret_rotated_at: string | null;
  created_at: string;
  updated_at: string;
  /** 낙관적 동시성 제어 토큰 — PATCH/Secret 재발급 요청 시 그대로 되돌려 보내야 한다. */
  edit_count: number;
}

/** 11_PROJECT_API.md 2.2 GET /projects 쿼리 파라미터. */
export interface ProjectListQuery extends PaginationQuery {
  company_id?: number;
  status?: number;
}

/** 11_PROJECT_API.md 2.1 POST /projects 요청. */
export interface CreateProjectRequest {
  company_id: number;
  project_code: string;
  project_name: string;
  description?: string;
}

/** 11_PROJECT_API.md 2.1 응답 — api_secret 평문은 이 응답에만 1회 노출. */
export interface ProjectCreateResult {
  project_id: number;
  company_id: number;
  project_code: string;
  project_name: string;
  description: string | null;
  api_key: string;
  status: number;
  created_at: string;
  updated_at: string;
  edit_count: number;
  api_secret: string;
}

/** 11_PROJECT_API.md 2.4 PATCH /projects/{project_id} 요청 — edit_count 필수. */
export interface UpdateProjectRequest {
  edit_count: number;
  project_name?: string;
  description?: string;
  status?: number;
}

/** 11_PROJECT_API.md 2.5 응답 — api_secret 평문은 이 응답에만 1회 노출. */
export interface RotateApiSecretResult {
  project_id: number;
  api_secret: string;
  secret_rotated_at: string;
  edit_count: number;
}
