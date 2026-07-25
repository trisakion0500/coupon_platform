import type { PaginationQuery } from '@/types/api';

/** 12_USER_API.md 3장 — `user_role` 원본 컬럼. role_code: 20/30/40, status: 0=중지, 1=사용. */
export interface UserRole {
  user_id: number;
  project_id: number;
  role_code: number;
  status: number;
  created_at: string;
  updated_at: string;
}

/** 12_USER_API.md 3.2 GET /user-roles 쿼리 파라미터 — 전부 선택 필터. */
export interface UserRoleListQuery extends PaginationQuery {
  user_id?: number;
  project_id?: number;
  role_code?: number;
  status?: number;
}

/** 12_USER_API.md 3.1 POST /user-roles 요청 — role_code는 20/30/40만 허용(10은 대상 아님). */
export interface CreateUserRoleRequest {
  user_id: number;
  project_id: number;
  role_code: number;
}

/** 12_USER_API.md 3.3 PATCH /user-roles/{user_id}/{project_id} 요청. */
export interface UpdateUserRoleRequest {
  role_code?: number;
  status?: number;
}
