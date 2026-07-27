import { apiClient } from '@/api/client';
import type { ApiEnvelope, PaginatedResult } from '@/types/api';
import type {
  ResetPasswordRequest,
  UpdateUserRequest,
  User,
  UserListQuery,
} from '@/types/user';

/** 14_USER_API.md 1.1 — company_id는 SUPER_ADMIN에게만 유효(DEVELOPER는 서버가 자기 회사로 고정). */
export async function listUsers(
  query: UserListQuery,
): Promise<PaginatedResult<User>> {
  const { data } = await apiClient.get<ApiEnvelope<PaginatedResult<User>>>(
    '/users',
    { params: query },
  );
  return data.data;
}

/** 14_USER_API.md 1.3 — DEVELOPER가 타 회사 사용자를 조회하면 20001(PERMISSION_DENIED). */
export async function getUser(userId: number): Promise<User> {
  const { data } = await apiClient.get<ApiEnvelope<User>>(`/users/${userId}`);
  return data.data;
}

/** 14_USER_API.md 1.4 — SUPER_ADMIN 전용, 0→1. */
export async function approveUser(userId: number): Promise<User> {
  const { data } = await apiClient.post<ApiEnvelope<User>>(
    `/users/${userId}/approve`,
  );
  return data.data;
}

/** 14_USER_API.md 1.5 — SUPER_ADMIN 전용, 0→2. */
export async function rejectUser(userId: number): Promise<User> {
  const { data } = await apiClient.post<ApiEnvelope<User>>(
    `/users/${userId}/reject`,
    {},
  );
  return data.data;
}

/** 14_USER_API.md 1.6 — SUPER_ADMIN 전용. status는 화면이 1↔3 전환 액션 버튼으로만 보낸다. */
export async function updateUser(
  userId: number,
  dto: UpdateUserRequest,
): Promise<User> {
  const { data } = await apiClient.patch<ApiEnvelope<User>>(
    `/users/${userId}`,
    dto,
  );
  return data.data;
}

/** 14_USER_API.md 1.7 — SUPER_ADMIN 전용, 현재 비밀번호 검증 없이 즉시 초기화. */
export async function resetUserPassword(
  userId: number,
  dto: ResetPasswordRequest,
): Promise<User> {
  const { data } = await apiClient.post<ApiEnvelope<User>>(
    `/users/${userId}/reset-password`,
    dto,
  );
  return data.data;
}
