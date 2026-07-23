import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle="요청하신 페이지를 찾을 수 없습니다."
      extra={
        <Button type="primary" onClick={() => navigate('/campaigns')}>
          홈으로
        </Button>
      }
    />
  );
}
