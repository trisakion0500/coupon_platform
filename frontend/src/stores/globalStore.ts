import { create } from 'zustand';
import type { ActiveCompany, ActiveHeaderData, ActiveProject } from '@/types/header';
import type { RoleCode } from '@/types/role';

/**
 * 18_LAYOUT.md 9장 globalStore — 헤더 회사/프로젝트 선택 상태. persist하지 않는다(로그인
 * 시 1회 로드하는 캐시라는 문서 설계 그대로 — 새로고침 시에는 `bootstrapSession`이
 * `accessToken`이 남아있으면 다시 로드한다, `src/App.tsx` 참고).
 */
interface GlobalState {
  selectedCompanyId: number | null;
  selectedProjectId: number | null;
  companyList: ActiveCompany[];
  projectList: ActiveProject[];
  projectRoleCode: RoleCode | null;
  /** 10_API_COMMON.md 6.2 — 로그인/세션복원 1회 로드 캐시(화면 문구용, 예: Secret 유예기간). */
  apiSecretGracePeriodDays: number | null;
  setHeaderData: (data: ActiveHeaderData) => void;
  setSelectedCompanyId: (companyId: number | null) => void;
  setSelectedProjectId: (projectId: number | null) => void;
  setProjectRoleCode: (roleCode: RoleCode | null) => void;
  setApiSecretGracePeriodDays: (days: number) => void;
  reset: () => void;
}

export const useGlobalStore = create<GlobalState>((set) => ({
  selectedCompanyId: null,
  selectedProjectId: null,
  companyList: [],
  projectList: [],
  projectRoleCode: null,
  apiSecretGracePeriodDays: null,
  setHeaderData: ({ companies, projects }) =>
    set({ companyList: companies, projectList: projects }),
  setSelectedCompanyId: (companyId) =>
    // 18_LAYOUT.md 2.1 — 회사 변경 시 프로젝트 선택 초기화.
    set({ selectedCompanyId: companyId, selectedProjectId: null, projectRoleCode: null }),
  setSelectedProjectId: (projectId) =>
    set({ selectedProjectId: projectId, projectRoleCode: null }),
  setProjectRoleCode: (roleCode) => set({ projectRoleCode: roleCode }),
  setApiSecretGracePeriodDays: (days) => set({ apiSecretGracePeriodDays: days }),
  reset: () =>
    set({
      selectedCompanyId: null,
      selectedProjectId: null,
      companyList: [],
      projectList: [],
      projectRoleCode: null,
      apiSecretGracePeriodDays: null,
    }),
}));
