import { useParams } from 'react-router-dom';
import { StubPage } from '@/components/common/StubPage';

/** SCR-031. */
export function UserDetailPage() {
  const { user_id } = useParams();
  return <StubPage title={`사용자 상세 (#${user_id})`} screenId="SCR-031" />;
}
