import { Card, Result, Typography } from 'antd';
import { useTranslation } from 'react-i18next';

/**
 * SCR-002. 09_AUTH_API.md 4장 + 15_SCREEN_LIST.md 2.1 — 회사/프로젝트 코드 조회
 * (`GET /companies/lookup`, `GET /projects/lookup`) + 회원가입 폼. 이번 세션은 구조+로그인
 * 세로슬라이스 범위라 폼 구현은 다음 단계로 미루고 라우팅 스텁만 둔다.
 */
export function SignupPage() {
  const { t } = useTranslation();
  return (
    <Card style={{ width: 420 }}>
      <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
        {import.meta.env.VITE_APP_NAME}
      </Typography.Title>
      <Result status="info" title={t('auth.signup.comingSoon')} />
    </Card>
  );
}
