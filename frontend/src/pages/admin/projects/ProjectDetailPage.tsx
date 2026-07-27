import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Result,
  Spin,
  Switch,
  Typography,
  message,
} from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getProject, rotateApiSecret, updateProject } from '@/api/project';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { PageHeader } from '@/components/common/PageHeader';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalStore } from '@/stores/globalStore';
import { RoleCode } from '@/types/role';
import type { Project } from '@/types/project';

interface ProjectForm {
  project_name: string;
  description?: string;
  status: boolean;
}

/** SCR-022. 13_PROJECT_API.md 2.3/2.4/2.5. */
export function ProjectDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { project_id } = useParams();
  const projectId = Number(project_id);
  const roleCode = useAuthStore((state) => state.roleCode);
  const isSuperAdmin = roleCode === RoleCode.SUPER_ADMIN;
  const gracePeriodDays = useGlobalStore((state) => state.apiSecretGracePeriodDays);
  const [form] = Form.useForm<ProjectForm>();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getProject(projectId)
      .then((data) => {
        setProject(data);
        form.setFieldsValue({
          project_name: data.project_name,
          description: data.description ?? undefined,
          status: data.status === 1,
        });
      })
      .catch((error: unknown) => {
        const resultCode = getResultCode(error);
        if (resultCode === 31002) {
          setNotFound(true);
        } else if (resultCode === 20001) {
          // 실제 user_role이 배정되지 않은 프로젝트에 URL 직접 접근한 경우(13_PROJECT_API.md 2.3)
          setForbidden(true);
        } else {
          setErrorMessage(getErrorMessage(error));
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(values: ProjectForm) {
    if (!project) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const updated = await updateProject(projectId, {
        edit_count: project.edit_count,
        project_name: values.project_name,
        description: values.description,
        status: values.status ? 1 : 0,
      });
      setProject(updated);
      message.success(t('admin.projects.detail.saveSuccess'));
    } catch (error) {
      const resultCode = getResultCode(error);
      if (resultCode === 30005) {
        setErrorMessage(t('admin.projects.errors.30005'));
        load();
      } else {
        setErrorMessage(getErrorMessage(error));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleRotateClick() {
    if (!project) return;
    Modal.confirm({
      title: t('admin.projects.detail.rotateConfirmTitle'),
      content: t('admin.projects.detail.rotateConfirmContent', {
        days: gracePeriodDays ?? '?',
      }),
      okText: t('admin.projects.detail.rotateConfirmOk'),
      onOk: async () => {
        setRotating(true);
        setErrorMessage(null);
        try {
          const result = await rotateApiSecret(projectId, project.edit_count);
          setProject({
            ...project,
            edit_count: result.edit_count,
            secret_rotated_at: result.secret_rotated_at,
          });
          setRotatedSecret(result.api_secret);
        } catch (error) {
          const resultCode = getResultCode(error);
          if (resultCode === 30005) {
            setErrorMessage(t('admin.projects.errors.30005'));
            load();
          } else {
            setErrorMessage(getErrorMessage(error));
          }
        } finally {
          setRotating(false);
        }
      },
    });
  }

  if (notFound) {
    return (
      <Result
        status="404"
        title={t('admin.projects.detail.notFound')}
        extra={
          <Button onClick={() => navigate('/admin/projects')}>
            {t('admin.projects.backToList')}
          </Button>
        }
      />
    );
  }

  if (forbidden) {
    return (
      <Result
        status="403"
        title={t('errors.forbidden.subtitle')}
        extra={
          <Button onClick={() => navigate('/admin/projects')}>
            {t('admin.projects.backToList')}
          </Button>
        }
      />
    );
  }

  return (
    <div>
      <PageHeader
        title={t('admin.projects.detail.title', { id: projectId })}
        actions={
          <Button onClick={() => navigate('/admin/projects')}>
            {t('admin.projects.backToList')}
          </Button>
        }
      />
      <Spin spinning={loading}>
        {errorMessage && (
          <Alert
            type="error"
            message={errorMessage}
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}

        {project && (
          <Card style={{ maxWidth: 640, marginBottom: 16 }}>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('admin.projects.fields.companyName')}>
                {project.company_name}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.projects.fields.projectCode')}>
                {project.project_code}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.projects.fields.apiKey')}>
                <Typography.Text code copyable>
                  {project.api_key}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.projects.fields.secretRotatedAt')}>
                {project.secret_rotated_at ?? t('admin.projects.detail.neverRotated')}
              </Descriptions.Item>
            </Descriptions>
            <Button loading={rotating} onClick={handleRotateClick}>
              {t('admin.projects.detail.rotateButton')}
            </Button>
          </Card>
        )}

        <Card style={{ maxWidth: 640, marginBottom: 16 }}>
          <Form<ProjectForm>
            form={form}
            layout="vertical"
            onFinish={handleSubmit}
            disabled={!isSuperAdmin}
          >
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
            <Form.Item
              name="status"
              label={t('admin.projects.fields.status')}
              valuePropName="checked"
            >
              <Switch
                checkedChildren={t('common.status.active')}
                unCheckedChildren={t('common.status.inactive')}
              />
            </Form.Item>
            {isSuperAdmin && (
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" loading={submitting}>
                  {t('admin.projects.detail.save')}
                </Button>
              </Form.Item>
            )}
          </Form>
        </Card>

        {project && (
          <Card>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('admin.projects.fields.createdAt')}>
                {project.created_at}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.projects.fields.updatedAt')}>
                {project.updated_at}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        )}
      </Spin>

      <Modal
        open={rotatedSecret !== null}
        closable={false}
        maskClosable={false}
        title={t('admin.projects.detail.rotateModalTitle')}
        footer={
          <Button type="primary" onClick={() => setRotatedSecret(null)}>
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
          <Typography.Text strong>{t('admin.projects.fields.apiSecret')}</Typography.Text>
          <br />
          <Typography.Text code copyable>
            {rotatedSecret}
          </Typography.Text>
        </Typography.Paragraph>
      </Modal>
    </div>
  );
}
