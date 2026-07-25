import { apiClient } from '@/api/client';
import type { ApiEnvelope, PaginatedResult } from '@/types/api';
import type {
  CreateUserRoleRequest,
  UpdateUserRoleRequest,
  UserRole,
  UserRoleListQuery,
} from '@/types/user-role';

/** 12_USER_API.md 3.2 — SUPER_ADMIN 전용, 전부 선택 필터. */
export async function listUserRoles(
  query: UserRoleListQuery,
): Promise<PaginatedResult<UserRole>> {
  const { data } = await apiClient.get<ApiEnvelope<PaginatedResult<UserRole>>>(
    '/user-roles',
    { params: query },
  );
  return data.data;
}

/** 12_USER_API.md 3.1 — SUPER_ADMIN 전용, 동일 user_id+project_id 중복 등록 불가(32001). */
export async function createUserRole(
  dto: CreateUserRoleRequest,
): Promise<UserRole> {
  const { data } = await apiClient.post<ApiEnvelope<UserRole>>(
    '/user-roles',
    dto,
  );
  return data.data;
}

/** 12_USER_API.md 3.3 — SUPER_ADMIN 전용, role_code=10 시도는 30003으로 거부된다. */
export async function updateUserRole(
  userId: number,
  projectId: number,
  dto: UpdateUserRoleRequest,
): Promise<UserRole> {
  const { data } = await apiClient.patch<ApiEnvelope<UserRole>>(
    `/user-roles/${userId}/${projectId}`,
    dto,
  );
  return data.data;
}
