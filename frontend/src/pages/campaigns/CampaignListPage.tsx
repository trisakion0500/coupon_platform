import { RequireProjectSelected } from '@/components/guards/RequireProjectSelected';
import { StubPage } from '@/components/common/StubPage';

/** SCR-100. */
export function CampaignListPage() {
  return (
    <RequireProjectSelected>
      <StubPage title="캠페인 목록" screenId="SCR-100" />
    </RequireProjectSelected>
  );
}
