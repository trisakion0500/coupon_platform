import type { ReactElement } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsAuthenticated } from '@/stores/authStore';

/** 18_LAYOUT.md 8장 — 인증 상태로 `/login`, `/signup` 접근 시 `/campaigns`로 리다이렉트. */
export function RequireGuest({ children }: { children: ReactElement }) {
  const isAuthenticated = useIsAuthenticated();

  if (isAuthenticated) {
    return <Navigate to="/campaigns" replace />;
  }

  return children;
}
