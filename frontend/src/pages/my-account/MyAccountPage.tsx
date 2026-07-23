import { useState } from 'react';
import { Button, Card, Descriptions, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { logout } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalStore } from '@/stores/globalStore';

/**
 * SCR-200 — 내 정보 조회 + 로그아웃까지만 이번 세로슬라이스 범위에 포함(비밀번호 변경 폼은
 * 다음 단계). `user`는 `SessionBoot`/로그인 시 이미 `authStore`에 채워져 있어 별도 조회
 * 없이 그대로 사용한다.
 */
export function MyAccountPage() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clear);
  const resetGlobal = useGlobalStore((state) => state.reset);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      // 서버 세션 종료가 실패해도 클라이언트는 로그아웃 상태로 전환한다.
      message.warning('로그아웃 처리 중 문제가 있었지만 세션을 종료합니다.');
    } finally {
      clearAuth();
      resetGlobal();
      navigate('/login', { replace: true });
    }
  }

  return (
    <div>
      <PageHeader
        title="내 계정"
        actions={
          <Button danger loading={loggingOut} onClick={handleLogout}>
            로그아웃
          </Button>
        }
      />
      <Card>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="로그인 ID">
            {user?.login_id}
          </Descriptions.Item>
          <Descriptions.Item label="이름">{user?.user_name}</Descriptions.Item>
          <Descriptions.Item label="이메일">{user?.email}</Descriptions.Item>
          <Descriptions.Item label="부서">
            {user?.department ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="직급">
            {user?.position ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="최근 로그인">
            {user?.last_login_at ?? '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
