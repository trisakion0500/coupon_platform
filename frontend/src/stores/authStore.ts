import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@/types/auth';
import type { RoleCode } from '@/types/role';

/**
 * 18_LAYOUT.md 9장 authStore — `accessToken`/`refreshToken`/`roleCode`만 persist된다.
 * `user`는 저장하지 않고 부팅 시 `/auth/me`로 재조회한다(persist 대상에서 명시적으로 제외).
 * `isAuthenticated`라는 저장 필드는 없고 `!!accessToken`으로 파생 계산한다.
 */
interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  roleCode: RoleCode | null;
  setUser: (user: AuthUser | null) => void;
  setSession: (session: {
    accessToken: string;
    refreshToken: string;
    roleCode: RoleCode;
  }) => void;
  setAccessToken: (accessToken: string, roleCode: RoleCode) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      roleCode: null,
      setUser: (user) => set({ user }),
      setSession: ({ accessToken, refreshToken, roleCode }) =>
        set({ accessToken, refreshToken, roleCode }),
      setAccessToken: (accessToken, roleCode) =>
        set({ accessToken, roleCode }),
      clear: () =>
        set({ user: null, accessToken: null, refreshToken: null, roleCode: null }),
    }),
    {
      name: 'auth-store',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        roleCode: state.roleCode,
      }),
    },
  ),
);

export function useIsAuthenticated(): boolean {
  return useAuthStore((state) => !!state.accessToken);
}
