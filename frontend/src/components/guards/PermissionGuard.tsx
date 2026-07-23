import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import type { RoleCode } from '@/types/role';

/**
 * 16_LAYOUT.md 10장 — role 조건 충족 시만 children을 렌더링한다(버튼 등 UI 요소 노출 제어).
 * `RoleGuard`와 달리 라우트 전환이 아니라 화면 일부만 숨긴다.
 */
export function PermissionGuard({
  allow,
  children,
}: {
  allow: RoleCode[];
  children: ReactNode;
}) {
  const roleCode = useAuthStore((state) => state.roleCode);

  if (roleCode === null || !allow.includes(roleCode)) {
    return null;
  }

  return children;
}
