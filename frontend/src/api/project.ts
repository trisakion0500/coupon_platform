import { apiClient } from '@/api/client';
import type { ApiEnvelope, PaginatedResult } from '@/types/api';
import type {
  CreateProjectRequest,
  Project,
  ProjectCreateResult,
  ProjectListQuery,
  RotateApiSecretResult,
  UpdateProjectRequest,
} from '@/types/project';
import type { RoleCode } from '@/types/role';

/** 13_PROJECT_API.md 2.2. */
export async function listProjects(
  query: ProjectListQuery,
): Promise<PaginatedResult<Project>> {
  const { data } = await apiClient.get<ApiEnvelope<PaginatedResult<Project>>>(
    '/projects',
    { params: query },
  );
  return data.data;
}

/** 13_PROJECT_API.md 2.3. */
export async function getProject(projectId: number): Promise<Project> {
  const { data } = await apiClient.get<ApiEnvelope<Project>>(
    `/projects/${projectId}`,
  );
  return data.data;
}

/** 13_PROJECT_API.md 2.1. */
export async function createProject(
  dto: CreateProjectRequest,
): Promise<ProjectCreateResult> {
  const { data } = await apiClient.post<ApiEnvelope<ProjectCreateResult>>(
    '/projects',
    dto,
  );
  return data.data;
}

/** 13_PROJECT_API.md 2.4 — edit_count 낙관적 락 필수. */
export async function updateProject(
  projectId: number,
  dto: UpdateProjectRequest,
): Promise<Project> {
  const { data } = await apiClient.patch<ApiEnvelope<Project>>(
    `/projects/${projectId}`,
    dto,
  );
  return data.data;
}

/** 13_PROJECT_API.md 2.5 — edit_count 낙관적 락 필수, 재발급은 멱등하지 않다. */
export async function rotateApiSecret(
  projectId: number,
  editCount: number,
): Promise<RotateApiSecretResult> {
  const { data } = await apiClient.post<ApiEnvelope<RotateApiSecretResult>>(
    `/projects/${projectId}/api-secret/rotate`,
    { edit_count: editCount },
  );
  return data.data;
}

interface MyRoleResponse {
  project_id: number;
  role_code: RoleCode | null;
}

/**
 * 13_PROJECT_API.md 3.1 — 헤더에서 선택된 프로젝트에 대한 호출자의 실제 role_code. 사이드바/
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

/** 13_PROJECT_API.md 2.6 — 회원가입 화면 전용, 인증 불필요. 미존재/비활성 시 31002. */
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
