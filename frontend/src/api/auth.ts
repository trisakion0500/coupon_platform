import { apiClient } from '@/api/client';
import type { ApiEnvelope } from '@/types/api';
import type { AuthUser, LoginResponse } from '@/types/auth';

/** 09_AUTH_API.md 5장. */
export async function login(
  loginId: string,
  password: string,
): Promise<LoginResponse> {
  const { data } = await apiClient.post<ApiEnvelope<LoginResponse>>(
    '/auth/login',
    { login_id: loginId, password },
  );
  return data.data;
}

/** 09_AUTH_API.md 6장 — 현재 세션 종료. */
export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

/** 09_AUTH_API.md 8장 — `role_code`는 응답에 없다(로그인/재발급 응답 값을 별도로 사용). */
export async function getMe(): Promise<AuthUser> {
  const { data } = await apiClient.get<ApiEnvelope<AuthUser>>('/auth/me');
  return data.data;
}

/** 09_AUTH_API.md 9장. */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await apiClient.patch('/auth/password', {
    current_password: currentPassword,
    new_password: newPassword,
  });
}
