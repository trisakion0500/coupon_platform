import { RequireProjectSelected } from '@/components/guards/RequireProjectSelected';
import { StubPage } from '@/components/common/StubPage';

/** SCR-103. */
export function CouponUseLogsPage() {
  return (
    <RequireProjectSelected>
      <StubPage title="쿠폰 사용 로그" screenId="SCR-103" />
    </RequireProjectSelected>
  );
}
