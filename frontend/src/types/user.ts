import type { PaginationQuery } from '@/types/api';

/** 14_USER_API.md 1장 — `user` 원본 컬럼. status: 0=승인대기, 1=정상, 2=반려, 3=사용중지. */
export interface User {
  user_id: number;
  company_id: number;
  requested_project_id: number | null;
  login_id: string;
  user_name: string;
  email: string;
  phone_number: string;
  department: string | null;
  position: string | null;
  status: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

/** 14_USER_API.md 1.1 GET /users 쿼리 파라미터 — company_id는 SUPER_ADMIN에게만 유효. */
export interface UserListQuery extends PaginationQuery {
  company_id?: number;
  status?: number;
}

/** 14_USER_API.md 1.6 PATCH /users/{user_id} 요청 — status는 화면이 액션 버튼으로만 전송한다. */
export interface UpdateUserRequest {
  user_name?: string;
  email?: string;
  phone_number?: string;
  department?: string;
  position?: string;
  status?: number;
}

/** 14_USER_API.md 1.7 POST /users/{user_id}/reset-password 요청. */
export interface ResetPasswordRequest {
  new_password: string;
}
