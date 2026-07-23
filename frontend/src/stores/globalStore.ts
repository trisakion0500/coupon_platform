import { create } from 'zustand';
import type { ActiveCompany, ActiveHeaderData, ActiveProject } from '@/types/header';
import type { RoleCode } from '@/types/role';

/**
 * 16_LAYOUT.md 9장 globalStore — 헤더 회사/프로젝트 선택 상태. persist하지 않는다(로그인
 * 시 1회 로드하는 캐시라는 문서 설계 그대로 — 새로고침 시에는 `bootstrapSession`이
 * `accessToken`이 남아있으면 다시 로드한다, `src/App.tsx` 참고).
 */
interface GlobalState {
  selectedCompanyId: number | null;
  selectedProjectId: number | null;
  companyList: ActiveCompany[];
  projectList: ActiveProject[];
  projectRoleCode: RoleCode | null;
  setHeaderData: (data: ActiveHeaderData) => void;
  setSelectedCompanyId: (companyId: number | null) => void;
  setSelectedProjectId: (projectId: number | null) => void;
  setProjectRoleCode: (roleCode: RoleCode | null) => void;
  reset: () => void;
}

export const useGlobalStore = create<GlobalState>((set) => ({
  selectedCompanyId: null,
  selectedProjectId: null,
  companyList: [],
  projectList: [],
  projectRoleCode: null,
  setHeaderData: ({ companies, projects }) =>
    set({ companyList: companies, projectList: projects }),
  setSelectedCompanyId: (companyId) =>
    // 16_LAYOUT.md 2.1 — 회사 변경 시 프로젝트 선택 초기화.
    set({ selectedCompanyId: companyId, selectedProjectId: null, projectRoleCode: null }),
  setSelectedProjectId: (projectId) =>
    set({ selectedProjectId: projectId, projectRoleCode: null }),
  setProjectRoleCode: (roleCode) => set({ projectRoleCode: roleCode }),
  reset: () =>
    set({
      selectedCompanyId: null,
      selectedProjectId: null,
      companyList: [],
      projectList: [],
      projectRoleCode: null,
    }),
}));
