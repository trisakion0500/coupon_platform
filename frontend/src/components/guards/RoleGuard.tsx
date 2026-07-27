import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import type { RoleCode } from '@/types/role';

/**
 * 18_LAYOUT.md 10장 — 라우트 단위 role 검사, 미충족 시 403 페이지. 화이트리스트 방식이다
 * (백엔드 `RolesGuard`와 동일 원칙 — 회사/프로젝트 관리메뉴는 상위 role이 하위를 자동
 * 포함하는 누적 구조의 예외이므로 "이 값 이상만 허용"이 아니라 허용 목록을 그대로 나열한다).
 */
export function RoleGuard({
  allow,
  children,
}: {
  allow: RoleCode[];
  children: ReactElement;
}) {
  const roleCode = useAuthStore((state) => state.roleCode);

  if (roleCode === null || !allow.includes(roleCode)) {
    return <Navigate to="/403" replace />;
  }

  return children;
}
