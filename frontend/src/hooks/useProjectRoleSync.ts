import { useEffect } from 'react';
import { getMyRoleForProject } from '@/api/project';
import { useGlobalStore } from '@/stores/globalStore';
import { useAuthStore } from '@/stores/authStore';
import { RoleCode } from '@/types/role';

/**
 * 11_PROJECT_API.md 3.1 — 선택된 프로젝트가 바뀔 때마다(헤더 선택 변경, 회사 변경에 따른
 * 첫 프로젝트 자동 선택 포함) `projectRoleCode`를 재조회한다. 화면의 메뉴/버튼 노출은 로그인
 * 시점 JWT의 role_code가 아니라 이 값을 기준으로 판단해야 한다. SUPER_ADMIN은 이 API가 항상
 * `role_code: 10`을 반환한다는 게 이미 문서로 확정돼 있어(3.1 Business Rules), 불필요한
 * 호출 없이 즉시 세팅한다.
 */
export function useProjectRoleSync() {
  const roleCode = useAuthStore((state) => state.roleCode);
  const selectedProjectId = useGlobalStore((state) => state.selectedProjectId);
  const setProjectRoleCode = useGlobalStore((state) => state.setProjectRoleCode);

  useEffect(() => {
    if (selectedProjectId === null) {
      setProjectRoleCode(null);
      return;
    }

    if (roleCode === RoleCode.SUPER_ADMIN) {
      setProjectRoleCode(RoleCode.SUPER_ADMIN);
      return;
    }

    let cancelled = false;
    void getMyRoleForProject(selectedProjectId).then((res) => {
      if (!cancelled) {
        setProjectRoleCode(res.role_code);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, roleCode, setProjectRoleCode]);
}
