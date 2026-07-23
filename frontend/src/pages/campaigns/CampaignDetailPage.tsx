import { useParams } from 'react-router-dom';
import { RequireProjectSelected } from '@/components/guards/RequireProjectSelected';
import { StubPage } from '@/components/common/StubPage';

/** SCR-102 — 탭 구성(정보/코드 목록/사용 이력/변경 이력)은 다음 단계에서 구현. */
export function CampaignDetailPage() {
  const { coupon_campaign_id } = useParams();
  return (
    <RequireProjectSelected>
      <StubPage
        title={`캠페인 상세 (#${coupon_campaign_id})`}
        screenId="SCR-102"
      />
    </RequireProjectSelected>
  );
}
