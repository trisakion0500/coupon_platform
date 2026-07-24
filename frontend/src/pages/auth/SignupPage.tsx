import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Result, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { signup } from '@/api/auth';
import { lookupCompany } from '@/api/company';
import { lookupProject } from '@/api/project';
import { getErrorMessage, getResultCode } from '@/api/errors';

const CODE_PATTERN = /^[A-Za-z0-9_.-]+$/;
const LOGIN_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

interface SignupForm {
  company_code: string;
  project_code?: string;
  login_id: string;
  password: string;
  confirm_password: string;
  user_name: string;
  email: string;
  phone_number: string;
  department?: string;
  position?: string;
}

/**
 * SCR-002. 09_AUTH_API.md 4장 + 15_SCREEN_LIST.md 2.1 — 회사/프로젝트는 드롭다운이 아니라
 * 코드 텍스트 입력이다(`GET /companies`/`GET /projects`가 인증 필수라 로그인 전엔 못 씀).
 * 코드 검증은 입력 중이 아니라 제출 시점에만 수행하고, 실제 가입(`POST /auth/signup`)까지
 * 이어서 진행한다 — 프로젝트 코드는 선택 입력(2026-07-24 백엔드도 선택으로 수정, 09_AUTH_API.md 4장 참고).
 */
export function SignupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm<SignupForm>();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(values: SignupForm) {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      let companyId: number;
      try {
        const company = await lookupCompany(values.company_code);
        companyId = company.company_id;
      } catch (error) {
        if (getResultCode(error) === 31001) {
          form.setFields([
            { name: 'company_code', errors: [t('auth.signup.errors.31001')] },
          ]);
          return;
        }
        throw error;
      }

      let projectId: number | undefined;
      if (values.project_code) {
        try {
          const project = await lookupProject(companyId, values.project_code);
          projectId = project.project_id;
        } catch (error) {
          if (getResultCode(error) === 31002) {
            form.setFields([
              {
                name: 'project_code',
                errors: [t('auth.signup.errors.31002')],
              },
            ]);
            return;
          }
          throw error;
        }
      }

      await signup({
        company_id: companyId,
        requested_project_id: projectId,
        login_id: values.login_id,
        password: values.password,
        user_name: values.user_name,
        email: values.email,
        phone_number: values.phone_number,
        department: values.department || undefined,
        position: values.position || undefined,
      });

      setDone(true);
    } catch (error) {
      const resultCode = getResultCode(error);
      setErrorMessage(
        t(`auth.signup.errors.${resultCode}`, {
          defaultValue: getErrorMessage(error),
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <Card style={{ width: 460 }}>
        <Result
          status="success"
          title={t('auth.signup.doneTitle')}
          subTitle={t('auth.signup.doneSubtitle')}
          extra={
            <Button type="primary" onClick={() => navigate('/login')}>
              {t('auth.signup.backToLogin')}
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <Card style={{ width: 460 }}>
      <Typography.Title level={3} style={{ textAlign: 'center', marginBottom: 8 }}>
        {t('auth.signup.title')}
      </Typography.Title>
      <Typography.Paragraph
        type="secondary"
        style={{ textAlign: 'center', marginBottom: 24 }}
      >
        {t('auth.signup.codeGuide')}
      </Typography.Paragraph>

      {errorMessage && (
        <Alert
          type="error"
          message={errorMessage}
          style={{ marginBottom: 16 }}
          showIcon
        />
      )}

      <Form<SignupForm> form={form} layout="vertical" onFinish={handleSubmit}>
        <Form.Item
          name="company_code"
          label={t('auth.signup.fields.companyCode')}
          rules={[
            { required: true, message: t('auth.signup.fields.companyCodeRequired') },
            { pattern: CODE_PATTERN, message: t('auth.signup.fields.codeFormat') },
            { max: 20 },
          ]}
        >
          <Input autoFocus />
        </Form.Item>
        <Form.Item
          name="project_code"
          label={t('auth.signup.fields.projectCode')}
          extra={t('auth.signup.fields.projectCodeOptional')}
          rules={[
            { pattern: CODE_PATTERN, message: t('auth.signup.fields.codeFormat') },
            { max: 20 },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="login_id"
          label={t('auth.signup.fields.loginId')}
          rules={[
            { required: true, message: t('auth.signup.fields.loginIdRequired') },
            { pattern: LOGIN_ID_PATTERN, message: t('auth.signup.fields.loginIdFormat') },
            { max: 100 },
          ]}
        >
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('auth.signup.fields.password')}
          rules={[
            { required: true, message: t('auth.signup.fields.passwordRequired') },
            { min: 4, max: 72, message: t('auth.signup.fields.passwordLength') },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm_password"
          label={t('auth.signup.fields.confirmPassword')}
          dependencies={['password']}
          rules={[
            {
              required: true,
              message: t('auth.signup.fields.confirmPasswordRequired'),
            },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('password') === value) {
                  return Promise.resolve();
                }
                return Promise.reject(
                  new Error(t('auth.signup.fields.confirmPasswordMismatch')),
                );
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="user_name"
          label={t('auth.signup.fields.userName')}
          rules={[
            { required: true, message: t('auth.signup.fields.userNameRequired') },
            { max: 100 },
          ]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          name="email"
          label={t('auth.signup.fields.email')}
          rules={[
            { required: true, message: t('auth.signup.fields.emailRequired') },
            { type: 'email', message: t('auth.signup.fields.emailFormat') },
            { max: 200 },
          ]}
        >
          <Input autoComplete="email" />
        </Form.Item>
        <Form.Item
          name="phone_number"
          label={t('auth.signup.fields.phoneNumber')}
          rules={[
            { required: true, message: t('auth.signup.fields.phoneNumberRequired') },
            { max: 20 },
          ]}
        >
          <Input placeholder="010-1234-5678" />
        </Form.Item>
        <Form.Item name="department" label={t('auth.signup.fields.department')} rules={[{ max: 100 }]}>
          <Input />
        </Form.Item>
        <Form.Item name="position" label={t('auth.signup.fields.position')} rules={[{ max: 100 }]}>
          <Input />
        </Form.Item>

        <Form.Item style={{ marginBottom: 8 }}>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            {t('auth.signup.submit')}
          </Button>
        </Form.Item>
      </Form>

      <Typography.Paragraph style={{ textAlign: 'center', margin: 0 }}>
        {t('auth.signup.hasAccount')} <Link to="/login">{t('auth.signup.login')}</Link>
      </Typography.Paragraph>
    </Card>
  );
}
