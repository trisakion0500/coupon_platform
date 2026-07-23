import { Result, Button } from 'antd';
import { useNavigate } from 'react-router-dom';

/** 16_LAYOUT.md 8장 — role 가드 미충족 시 이동하는 403 페이지. */
export function ForbiddenPage() {
  const navigate = useNavigate();
  return (
    <Result
      status="403"
      title="403"
      subTitle="이 화면에 접근할 권한이 없습니다."
      extra={
        <Button type="primary" onClick={() => navigate('/campaigns')}>
          홈으로
        </Button>
      }
    />
  );
}
