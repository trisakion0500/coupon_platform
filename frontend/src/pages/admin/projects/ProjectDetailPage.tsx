import { useParams } from 'react-router-dom';
import { StubPage } from '@/components/common/StubPage';

/** SCR-022. */
export function ProjectDetailPage() {
  const { project_id } = useParams();
  return <StubPage title={`프로젝트 상세 (#${project_id})`} screenId="SCR-022" />;
}
