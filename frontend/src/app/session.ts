import { getActiveHeaderData } from '@/api/company';
import { getMe } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalStore } from '@/stores/globalStore';
import { RoleCode } from '@/types/role';

/**
 * 로그인 직후(`LoginPage`) 또는 새로고침으로 세션이 복원될 때(`SessionBoot`) 공통으로
 * 수행하는 초기화 — `/auth/me`로 user 재조회 + `/companies/active-header-data`로 헤더
 * 콤보박스 데이터 1회 로드(16_LAYOUT.md 2.1/9장). 기본 선택값은 SUPER_ADMIN이면 "전체
 * 회사"/"전체 프로젝트"(null), 그 외는 유일하게 배정된 본인 회사 + 목록의 첫 프로젝트로
 * 맞춘다 — 이후 헤더에서 언제든 바꿀 수 있는 초기값일 뿐이다.
 */
export async function loadSessionData(roleCode: RoleCode): Promise<void> {
  const [user, headerData] = await Promise.all([
    getMe(),
    getActiveHeaderData(),
  ]);

  useAuthStore.getState().setUser(user);
  useGlobalStore.getState().setHeaderData(headerData);

  if (roleCode === RoleCode.SUPER_ADMIN) {
    useGlobalStore.getState().setSelectedCompanyId(null);
    useGlobalStore.getState().setSelectedProjectId(null);
    return;
  }

  useGlobalStore
    .getState()
    .setSelectedCompanyId(headerData.companies[0]?.company_id ?? null);
  useGlobalStore
    .getState()
    .setSelectedProjectId(headerData.projects[0]?.project_id ?? null);
}
