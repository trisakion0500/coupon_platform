import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Result,
  Spin,
  Switch,
  message,
} from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getCompany, updateCompany } from '@/api/company';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { PageHeader } from '@/components/common/PageHeader';
import type { Company } from '@/types/company';

const CODE_PATTERN = /^[A-Za-z0-9_.-]+$/;

interface CompanyForm {
  company_code: string;
  company_name: string;
  description?: string;
  status: boolean;
}

/** SCR-012. 10_COMPANY_API.md 2.3/2.4. */
export function CompanyDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { company_id } = useParams();
  const companyId = Number(company_id);
  const [form] = Form.useForm<CompanyForm>();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getCompany(companyId)
      .then((data) => {
        setCompany(data);
        form.setFieldsValue({
          company_code: data.company_code,
          company_name: data.company_name,
          description: data.description ?? undefined,
          status: data.status === 1,
        });
      })
      .catch((error: unknown) => {
        if (getResultCode(error) === 31001) {
          setNotFound(true);
        } else {
          setErrorMessage(getErrorMessage(error));
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(values: CompanyForm) {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const updated = await updateCompany(companyId, {
        company_code: values.company_code,
        company_name: values.company_name,
        description: values.description,
        status: values.status ? 1 : 0,
      });
      setCompany(updated);
      message.success(t('admin.companies.detail.saveSuccess'));
    } catch (error) {
      const resultCode = getResultCode(error);
      if (resultCode === 32001) {
        form.setFields([
          { name: 'company_code', errors: [t('admin.companies.errors.32001')] },
        ]);
      } else {
        setErrorMessage(getErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (notFound) {
    return (
      <Result
        status="404"
        title={t('admin.companies.detail.notFound')}
        extra={
          <Button onClick={() => navigate('/admin/companies')}>
            {t('admin.companies.backToList')}
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={t('admin.companies.detail.title', { id: companyId })}
        actions={
          <Button onClick={() => navigate('/admin/companies')}>
            {t('admin.companies.backToList')}
          </Button>
        }
      />
      <Spin spinning={loading}>
        <Card style={{ maxWidth: 560, marginBottom: 16 }}>
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
              <Input />
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
            <Form.Item
              name="status"
              label={t('admin.companies.fields.status')}
              valuePropName="checked"
            >
              <Switch
                checkedChildren={t('common.status.active')}
                unCheckedChildren={t('common.status.inactive')}
              />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {t('admin.companies.detail.save')}
              </Button>
            </Form.Item>
          </Form>
        </Card>

        {company && (
          <Card>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('admin.companies.fields.createdAt')}>
                {company.created_at}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.companies.fields.updatedAt')}>
                {company.updated_at}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        )}
      </Spin>
    </div>
  );
}
