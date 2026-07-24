import { useState } from 'react';
import { Alert, Button, Card, Form, Input, Modal, Select, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { createProject } from '@/api/project';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { PageHeader } from '@/components/common/PageHeader';
import { useGlobalStore } from '@/stores/globalStore';
import type { ProjectCreateResult } from '@/types/project';

const CODE_PATTERN = /^[A-Za-z0-9_.-]+$/;

interface ProjectForm {
  company_id: number;
  project_code: string;
  project_name: string;
  description?: string;
}

/** SCR-021. 11_PROJECT_API.md 2.1 — 등록 성공 시 api_key/api_secret을 모달로 1회 노출. */
export function ProjectNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const companyList = useGlobalStore((state) => state.companyList);
  const [form] = Form.useForm<ProjectForm>();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [created, setCreated] = useState<ProjectCreateResult | null>(null);

  async function handleSubmit(values: ProjectForm) {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const project = await createProject(values);
      setCreated(project);
    } catch (error) {
      const resultCode = getResultCode(error);
      if (resultCode === 32001) {
        form.setFields([
          { name: 'project_code', errors: [t('admin.projects.errors.32001')] },
        ]);
      } else if (resultCode === 31001) {
        form.setFields([
          { name: 'company_id', errors: [t('admin.projects.errors.31001')] },
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
        title={t('admin.projects.new.title')}
        actions={
          <Button onClick={() => navigate('/admin/projects')}>
            {t('admin.projects.backToList')}
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
        <Form<ProjectForm> form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="company_id"
            label={t('admin.projects.fields.companyName')}
            rules={[{ required: true, message: t('admin.projects.fields.companyRequired') }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={companyList.map((c) => ({
                value: c.company_id,
                label: c.company_name,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="project_code"
            label={t('admin.projects.fields.projectCode')}
            rules={[
              { required: true, message: t('admin.projects.fields.projectCodeRequired') },
              { pattern: CODE_PATTERN, message: t('admin.projects.fields.codeFormat') },
              { max: 20 },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="project_name"
            label={t('admin.projects.fields.projectName')}
            rules={[
              { required: true, message: t('admin.projects.fields.projectNameRequired') },
              { max: 100 },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="description"
            label={t('admin.projects.fields.description')}
            rules={[{ max: 1000 }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {t('admin.projects.new.submit')}
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Modal
        open={created !== null}
        closable={false}
        maskClosable={false}
        title={t('admin.projects.new.secretModalTitle')}
        footer={
          <Button
            type="primary"
            onClick={() => created && navigate(`/admin/projects/${created.project_id}`, { replace: true })}
          >
            {t('admin.projects.new.secretModalConfirm')}
          </Button>
        }
      >
        <Alert
          type="warning"
          showIcon
          message={t('admin.projects.new.secretModalWarning')}
          style={{ marginBottom: 16 }}
        />
        <Typography.Paragraph>
          <Typography.Text strong>{t('admin.projects.fields.apiKey')}</Typography.Text>
          <br />
          <Typography.Text code copyable>
            {created?.api_key}
          </Typography.Text>
        </Typography.Paragraph>
        <Typography.Paragraph>
          <Typography.Text strong>{t('admin.projects.fields.apiSecret')}</Typography.Text>
          <br />
          <Typography.Text code copyable>
            {created?.api_secret}
          </Typography.Text>
        </Typography.Paragraph>
      </Modal>
    </div>
  );
}
