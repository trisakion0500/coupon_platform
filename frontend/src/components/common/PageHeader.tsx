import type { ReactNode } from 'react';
import { Space, Typography } from 'antd';

/** 18_LAYOUT.md 10장 — 페이지 제목 + 우측 액션 버튼 영역. */
export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}
    >
      <Typography.Title level={4} style={{ margin: 0 }}>
        {title}
      </Typography.Title>
      {actions ? <Space>{actions}</Space> : null}
    </div>
  );
}
