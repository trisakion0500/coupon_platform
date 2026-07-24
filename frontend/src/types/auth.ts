import type { RoleCode } from './role';

/** 09_AUTH_API.md 8장 GET /auth/me 응답 — user 테이블 원본 컬럼만, role_code 미포함. */
export interface AuthUser {
  user_id: number;
  company_id: number;
  requested_project_id: number;
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

/** 09_AUTH_API.md 4장 POST /auth/signup 요청 — requested_project_id는 선택 입력. */
export interface SignupRequest {
  company_id: number;
  requested_project_id?: number;
  login_id: string;
  password: string;
  user_name: string;
  email: string;
  phone_number: string;
  department?: string;
  position?: string;
}

/** 09_AUTH_API.md 5장 POST /auth/login 응답. */
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expired_at: string;
  role_code: RoleCode;
}

/** 09_AUTH_API.md 7장 POST /auth/refresh 응답. */
export interface RefreshResponse {
  access_token: string;
  expired_at: string;
  role_code: RoleCode;
}
