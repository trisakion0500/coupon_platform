import { useEffect, useState, type ReactNode } from 'react';
import { Spin } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { loadSessionData } from '@/app/session';

/**
 * 새로고침 시 `accessToken`/`roleCode`는 persist돼 남아있지만 `user`/헤더 데이터는 세션
 * 메모리에만 있던 값이라 사라진다(18_LAYOUT.md 9장 — user는 의도적으로 persist 대상이
 * 아님). 앱 부팅 시 토큰이 남아있는데 `user`가 없으면 한 번만 다시 로드한다.
 */
export function SessionBoot({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const roleCode = useAuthStore((state) => state.roleCode);
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clear);
  const [booting, setBooting] = useState(!!accessToken && !user);

  // 마운트 시 1회만 실행하려는 의도(accessToken/user는 위 얼리 리턴으로 이미 최신값 반영).
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!accessToken || user || roleCode === null) {
      return;
    }

    let cancelled = false;
    setBooting(true);
    loadSessionData(roleCode)
      .catch(() => {
        // Refresh Token까지 만료된 경우 등 — 세션을 비우고 로그인 화면에서 다시 시작한다.
        if (!cancelled) {
          clearAuth();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBooting(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (booting) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
        }}
      >
        <Spin size="large" />
      </div>
    );
  }

  return children;
}
