import { Result } from 'antd';
import { PageHeader } from '@/components/common/PageHeader';

/** 아직 구현 전인 화면의 자리표시자 — 라우팅/레이아웃 골격 검증용. */
export function StubPage({ title, screenId }: { title: string; screenId: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <Result status="info" title={`${screenId} 구현 예정`} />
    </div>
  );
}
