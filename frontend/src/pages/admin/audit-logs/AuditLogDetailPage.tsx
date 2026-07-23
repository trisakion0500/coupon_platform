import { useParams } from 'react-router-dom';
import { StubPage } from '@/components/common/StubPage';

/** SCR-041. */
export function AuditLogDetailPage() {
  const { idx } = useParams();
  return <StubPage title={`감사 로그 상세 (#${idx})`} screenId="SCR-041" />;
}
