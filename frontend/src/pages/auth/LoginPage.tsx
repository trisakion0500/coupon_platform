import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { login } from '@/api/auth';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { loadSessionData } from '@/app/session';

interface LoginForm {
  login_id: string;
  password: string;
}

/** SCR-001. */
export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((state) => state.setSession);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(values: LoginForm) {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await login(values.login_id, values.password);
      setSession({
        accessToken: res.access_token,
        refreshToken: res.refresh_token,
        roleCode: res.role_code,
      });
      await loadSessionData(res.role_code);

      const from =
        (location.state as { from?: Location } | null)?.from?.pathname ??
        '/campaigns';
      navigate(from, { replace: true });
    } catch (error) {
      // 11_AUTH_API.md 5장 result 코드는 프론트 문자열로만 번역한다 — 백엔드 message는
      // 한글로 유지하기로 했으므로(2026-07-24) 서버 message는 알려진 코드가 아닐 때만 폴백.
      const resultCode = getResultCode(error);
      setErrorMessage(
        t(`auth.login.errors.${resultCode}`, {
          defaultValue: getErrorMessage(error),
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card style={{ width: 360 }}>
      <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 24 }}>
        {import.meta.env.VITE_APP_NAME}
      </Typography.Title>

      {errorMessage && (
        <Alert
          type="error"
          message={errorMessage}
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      <Form<LoginForm> layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="login_id"
          label={t('auth.login.loginId')}
          rules={[{ required: true, message: t('auth.login.loginIdRequired') }]}
        >
          <Input autoFocus autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('auth.login.password')}
          rules={[{ required: true, message: t('auth.login.passwordRequired') }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 8 }}>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {t('auth.login.submit')}
          </Button>
        </Form.Item>
      </Form>

      <Typography.Paragraph style={{ textAlign: 'center', margin: 0 }}>
        {t('auth.login.noAccount')} <a href="/signup">{t('auth.login.signup')}</a>
      </Typography.Paragraph>
    </Card>
  );
}
