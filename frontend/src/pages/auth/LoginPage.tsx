import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import { login } from '@/api/auth';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { loadSessionData } from '@/app/session';

/** 09_AUTH_API.md 5장 result 코드 중 로그인 화면에서 의미 있는 안내 문구로 바꿀 것들. */
const LOGIN_ERROR_MESSAGES: Record<number, string> = {
  10001: '로그인 ID 또는 비밀번호가 올바르지 않습니다.',
  10002: '로그인 ID 또는 비밀번호가 올바르지 않습니다.',
  10005: '아직 가입 승인 대기 중인 계정입니다.',
  10006: '가입이 반려된 계정입니다. 관리자에게 문의해주세요.',
  10007: '사용이 중지된 계정입니다. 관리자에게 문의해주세요.',
  40001: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
};

interface LoginForm {
  login_id: string;
  password: string;
}

/** SCR-001. */
export function LoginPage() {
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
      const resultCode = getResultCode(error);
      setErrorMessage(
        (resultCode !== null && LOGIN_ERROR_MESSAGES[resultCode]) ||
          getErrorMessage(error),
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
          label="로그인 ID"
          rules={[{ required: true, message: '로그인 ID를 입력해주세요.' }]}
        >
          <Input autoFocus autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="password"
          label="비밀번호"
          rules={[{ required: true, message: '비밀번호를 입력해주세요.' }]}
        >
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 8 }}>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            로그인
          </Button>
        </Form.Item>
      </Form>

      <Typography.Paragraph style={{ textAlign: 'center', margin: 0 }}>
        계정이 없으신가요? <a href="/signup">회원가입</a>
      </Typography.Paragraph>
    </Card>
  );
}
