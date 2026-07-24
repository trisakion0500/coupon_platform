import { apiClient } from '@/api/client';
import type { ApiEnvelope } from '@/types/api';
import type { RoleCode } from '@/types/role';

interface MyRoleResponse {
  project_id: number;
  role_code: RoleCode | null;
}

/**
 * 11_PROJECT_API.md 3.1 — 헤더에서 선택된 프로젝트에 대한 호출자의 실제 role_code. 사이드바/
 * 버튼 노출은 로그인 시점 JWT의 role_code가 아니라 이 값을 기준으로 판단해야 한다.
 */
export async function getMyRoleForProject(
  projectId: number,
): Promise<MyRoleResponse> {
  const { data } = await apiClient.get<ApiEnvelope<MyRoleResponse>>(
    '/user-roles/me',
    { params: { project_id: projectId } },
  );
  return data.data;
}

interface ProjectLookupResponse {
  project_id: number;
  project_name: string;
}

/** 11_PROJECT_API.md 2.6 — 회원가입 화면 전용, 인증 불필요. 미존재/비활성 시 31002. */
export async function lookupProject(
  companyId: number,
  projectCode: string,
): Promise<ProjectLookupResponse> {
  const { data } = await apiClient.get<ApiEnvelope<ProjectLookupResponse>>(
    '/projects/lookup',
    { params: { company_id: companyId, project_code: projectCode } },
  );
  return data.data;
}
