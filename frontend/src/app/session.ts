import { getActiveHeaderData } from '@/api/company';
import { getPublicConfig } from '@/api/config';
import { getMe } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalStore } from '@/stores/globalStore';
import { RoleCode } from '@/types/role';

/**
 * 로그인 직후(`LoginPage`) 또는 새로고침으로 세션이 복원될 때(`SessionBoot`) 공통으로
 * 수행하는 초기화 — `/auth/me`로 user 재조회 + `/companies/active-header-data`로 헤더
 * 콤보박스 데이터 1회 로드(16_LAYOUT.md 2.1/9장) + `/config/public`으로 화면 문구용 공개
 * 설정값 1회 로드(08_API_COMMON.md 6.2). 기본 선택값은 SUPER_ADMIN이면 "전체
 * 회사"/"전체 프로젝트"(null), 그 외는 유일하게 배정된 본인 회사 + 목록의 첫 프로젝트로
 * 맞춘다 — 이후 헤더에서 언제든 바꿀 수 있는 초기값일 뿐이다.
 */
export async function loadSessionData(roleCode: RoleCode): Promise<void> {
  const [user, headerData, publicConfig] = await Promise.all([
    getMe(),
    getActiveHeaderData(),
    getPublicConfig(),
  ]);

  useAuthStore.getState().setUser(user);
  useGlobalStore.getState().setHeaderData(headerData);
  useGlobalStore
    .getState()
    .setApiSecretGracePeriodDays(publicConfig.api_secret_grace_period_days);

  if (roleCode === RoleCode.SUPER_ADMIN) {
    useGlobalStore.getState().setSelectedCompanyId(null);
    useGlobalStore.getState().setSelectedProjectId(null);
    return;
  }

  const defaultCompanyId = headerData.companies[0]?.company_id ?? null;
  useGlobalStore.getState().setSelectedCompanyId(defaultCompanyId);

  // headerData.projects는 회사 필터 없이 본인의 모든 user_role 배정을 반환한다(예외적으로
  // 타사 프로젝트에 배정된 경우 포함 — SP_COMPANY_GET_ACTIVE_HEADER_DATA). 그런데 Header의
  // 프로젝트 콤보박스는 selectedCompanyId로 필터링해서 보여주고, non-SUPER_ADMIN은 회사를
  // 바꿀 방법이 없다. 필터 없이 그냥 projects[0]을 기본 선택하면 그 프로젝트가 타사 소속일 때
  // 콤보박스 옵션에는 없는 값이 선택돼 antd가 라벨 대신 원본 project_id를 그대로 표시하는
  // 버그가 있었다(2026-07-24 발견) — 기본값도 본인 회사 범위 안에서만 고른다.
  const defaultProject =
    headerData.projects.find((p) => p.company_id === defaultCompanyId) ?? null;
  useGlobalStore.getState().setSelectedProjectId(defaultProject?.project_id ?? null);
}
