import { RequireProjectSelected } from '@/components/guards/RequireProjectSelected';
import { StubPage } from '@/components/common/StubPage';

/** SCR-101. */
export function CampaignNewPage() {
  return (
    <RequireProjectSelected>
      <StubPage title="캠페인 등록" screenId="SCR-101" />
    </RequireProjectSelected>
  );
}
