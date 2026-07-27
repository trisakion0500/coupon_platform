import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { RoleCode } from '@/types/role';

/** 18_LAYOUT.md 4.1/8장 — `/admin` 진입 시 역할별 첫 메뉴로 리다이렉트. */
export function AdminIndexRedirect() {
  const roleCode = useAuthStore((state) => state.roleCode);

  if (roleCode === RoleCode.SUPER_ADMIN) {
    return <Navigate to="/admin/companies" replace />;
  }
  return <Navigate to="/admin/projects" replace />;
}
