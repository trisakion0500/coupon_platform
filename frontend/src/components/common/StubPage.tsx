import { Result } from 'antd';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/common/PageHeader';

/**
 * 아직 구현 전인 화면의 자리표시자 — 라우팅/레이아웃 골격 검증용. `title`(각 stub 페이지가
 * 넘기는 화면명, 예: "캠페인 목록")은 실제 화면을 구현할 때 그 도메인의 i18n 키로 대체될
 * 임시값이라 여기서는 번역 대상에 넣지 않는다 — 이 컴포넌트 자체의 문구만 다국어화한다.
 */
export function StubPage({ title, screenId }: { title: string; screenId: string }) {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={title} />
      <Result status="info" title={t('stub.comingSoon', { screenId })} />
    </div>
  );
}
