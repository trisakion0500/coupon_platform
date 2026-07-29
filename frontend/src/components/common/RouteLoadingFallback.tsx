import { Spin } from 'antd';

/** React.lazy 라우트 청크 로딩 중 표시하는 공용 Suspense fallback. */
export function RouteLoadingFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        width: '100%',
      }}
    >
      <Spin size="large" />
    </div>
  );
}
