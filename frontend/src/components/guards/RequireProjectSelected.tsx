import type { ReactNode } from 'react';
import { Empty } from 'antd';
import { useGlobalStore } from '@/stores/globalStore';

/**
 * 16_LAYOUT.md 8장 — `selectedProjectId`가 `null`(전체 프로젝트)인 상태로 `/campaigns*`,
 * `/coupon-use-logs`에 접근하면 하드 리다이렉트가 아니라 화면 내 안내로 대체한다. 헤더에서
 * 바로 프로젝트를 골라 이어서 볼 수 있게 하기 위함(SUPER_ADMIN이 "전체 프로젝트"를 선택한
 * 경우에만 발생 — 다른 role은 애초에 "전체 프로젝트"를 선택할 수 없다).
 */
export function RequireProjectSelected({ children }: { children: ReactNode }) {
  const selectedProjectId = useGlobalStore((state) => state.selectedProjectId);

  if (selectedProjectId === null) {
    return (
      <Empty
        description="상단 헤더에서 프로젝트를 먼저 선택해주세요."
        style={{ marginTop: 80 }}
      />
    );
  }

  return children;
}
