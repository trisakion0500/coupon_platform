import { useParams } from 'react-router-dom';
import { StubPage } from '@/components/common/StubPage';

/** SCR-012. */
export function CompanyDetailPage() {
  const { company_id } = useParams();
  return <StubPage title={`회사 상세 (#${company_id})`} screenId="SCR-012" />;
}
