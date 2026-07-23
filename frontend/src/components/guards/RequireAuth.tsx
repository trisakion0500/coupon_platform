import type { ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useIsAuthenticated } from '@/stores/authStore';

/** 16_LAYOUT.md 8장 — 미인증 상태로 인증 필요 Route 접근 시 `/login`으로 리다이렉트. */
export function RequireAuth({ children }: { children: ReactElement }) {
  const isAuthenticated = useIsAuthenticated();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}
