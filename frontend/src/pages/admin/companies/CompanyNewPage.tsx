import { useState } from 'react';
import { Alert, Button, Card, Form, Input } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { createCompany } from '@/api/company';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { PageHeader } from '@/components/common/PageHeader';

const CODE_PATTERN = /^[A-Za-z0-9_.-]+$/;

interface CompanyForm {
  company_code: string;
  company_name: string;
  description?: string;
}

/** SCR-011. 10_COMPANY_API.md 2.1. */
export function CompanyNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [form] = Form.useForm<CompanyForm>();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(values: CompanyForm) {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const company = await createCompany(values);
      navigate(`/admin/companies/${company.company_id}`, { replace: true });
    } catch (error) {
      const resultCode = getResultCode(error);
      if (resultCode === 32001) {
        form.setFields([
          {
            name: 'company_code',
            errors: [t('admin.companies.errors.32001')],
          },
        ]);
      } else {
        setErrorMessage(getErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t('admin.companies.new.title')}
        actions={
          <Button onClick={() => navigate('/admin/companies')}>
            {t('admin.companies.backToList')}
          </Button>
        }
      />
      <Card style={{ maxWidth: 560 }}>
        {errorMessage && (
          <Alert
            type="error"
            message={errorMessage}
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}
        <Form<CompanyForm> form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="company_code"
            label={t('admin.companies.fields.companyCode')}
            rules={[
              { required: true, message: t('admin.companies.fields.companyCodeRequired') },
              { pattern: CODE_PATTERN, message: t('admin.companies.fields.codeFormat') },
              { max: 20 },
            ]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            name="company_name"
            label={t('admin.companies.fields.companyName')}
            rules={[
              { required: true, message: t('admin.companies.fields.companyNameRequired') },
              { max: 100 },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="description"
            label={t('admin.companies.fields.description')}
            rules={[{ max: 1000 }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {t('admin.companies.new.submit')}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
