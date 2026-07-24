import { apiClient } from '@/api/client';
import type { ApiEnvelope, PaginatedResult } from '@/types/api';
import type { User, UserListQuery } from '@/types/user';

/** 12_USER_API.md 1.1 — company_id는 SUPER_ADMIN에게만 유효(DEVELOPER는 서버가 자기 회사로 고정). */
export async function listUsers(
  query: UserListQuery,
): Promise<PaginatedResult<User>> {
  const { data } = await apiClient.get<ApiEnvelope<PaginatedResult<User>>>(
    '/users',
    { params: query },
  );
  return data.data;
}
