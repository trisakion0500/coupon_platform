import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Modal,
  Popconfirm,
  Result,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  message,
} from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  approveUser,
  getUser,
  rejectUser,
  resetUserPassword,
  updateUser,
} from '@/api/user';
import { createUserRole, listUserRoles, updateUserRole } from '@/api/user-role';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { PageHeader } from '@/components/common/PageHeader';
import { UserStatusTag } from '@/components/common/UserStatusTag';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalStore } from '@/stores/globalStore';
import { RoleCode } from '@/types/role';
import type { User } from '@/types/user';
import type { UserRole } from '@/types/user-role';

interface EditForm {
  user_name: string;
  email: string;
  phone_number: string;
  department?: string;
  position?: string;
}

interface ResetPasswordForm {
  new_password: string;
}

interface CreateRoleForm {
  project_id: number;
  role_code: number;
}

interface EditRoleForm {
  role_code: number;
  status: boolean;
}

const ASSIGNABLE_ROLE_CODES = [
  { value: RoleCode.DEVELOPER, label: 'DEVELOPER' },
  { value: RoleCode.MANAGER, label: 'MANAGER' },
  { value: RoleCode.OPERATOR, label: 'OPERATOR' },
];

function roleCodeLabel(roleCode: number): string {
  return (
    ASSIGNABLE_ROLE_CODES.find((option) => option.value === roleCode)?.label ??
    String(roleCode)
  );
}

/**
 * SCR-031. 12_USER_API.md 1장(승인/반려/수정/비밀번호초기화, 전부 SUPER_ADMIN 전용) +
 * 3장(User Role 배정). DEVELOPER는 조회만 가능해 액션 영역 전체를 숨긴다(ProjectDetailPage와
 * 동일한 isSuperAdmin 분기 패턴).
 */
export function UserDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user_id } = useParams();
  const userId = Number(user_id);
  const roleCode = useAuthStore((state) => state.roleCode);
  const isSuperAdmin = roleCode === RoleCode.SUPER_ADMIN;
  const projectList = useGlobalStore((state) => state.projectList);

  const [editForm] = Form.useForm<EditForm>();
  const [resetPasswordForm] = Form.useForm<ResetPasswordForm>();
  const [createRoleForm] = Form.useForm<CreateRoleForm>();
  const [editRoleForm] = Form.useForm<EditRoleForm>();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  const [roles, setRoles] = useState<UserRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [createRoleError, setCreateRoleError] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<UserRole | null>(null);
  const [savingRole, setSavingRole] = useState(false);
  const [editRoleError, setEditRoleError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getUser(userId)
      .then((data) => {
        setUser(data);
        editForm.setFieldsValue({
          user_name: data.user_name,
          email: data.email,
          phone_number: data.phone_number,
          department: data.department ?? undefined,
          position: data.position ?? undefined,
        });
      })
      .catch((error: unknown) => {
        const resultCode = getResultCode(error);
        if (resultCode === 31003) {
          setNotFound(true);
        } else if (resultCode === 20001) {
          setForbidden(true);
        } else {
          setErrorMessage(getErrorMessage(error));
        }
      })
      .finally(() => setLoading(false));
  }

  function loadRoles() {
    if (!isSuperAdmin) return;
    setRolesLoading(true);
    listUserRoles({ user_id: userId, page: 1, page_size: 100 })
      .then((result) => setRoles(result.items))
      .catch((error: unknown) => message.error(getErrorMessage(error)))
      .finally(() => setRolesLoading(false));
  }

  useEffect(load, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(loadRoles, [userId, isSuperAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleApprove() {
    setActionLoading(true);
    try {
      setUser(await approveUser(userId));
      message.success(t('admin.users.detail.approveSuccess'));
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject() {
    setActionLoading(true);
    try {
      setUser(await rejectUser(userId));
      message.success(t('admin.users.detail.rejectSuccess'));
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSuspend() {
    setActionLoading(true);
    try {
      setUser(await updateUser(userId, { status: 3 }));
      message.success(t('admin.users.detail.suspendSuccess'));
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReactivate() {
    setActionLoading(true);
    try {
      setUser(await updateUser(userId, { status: 1 }));
      message.success(t('admin.users.detail.reactivateSuccess'));
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  /** 12_USER_API.md 1.6 — 반려(2)는 종결 상태가 아니라 재검토를 위해 승인대기(0)로 되돌릴 수 있다. */
  async function handleBackToPending() {
    setActionLoading(true);
    try {
      setUser(await updateUser(userId, { status: 0 }));
      message.success(t('admin.users.detail.backToPendingSuccess'));
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setActionLoading(false);
    }
  }

  async function handleEditSubmit(values: EditForm) {
    setSaving(true);
    setErrorMessage(null);
    try {
      setUser(await updateUser(userId, values));
      message.success(t('admin.users.detail.saveSuccess'));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPasswordSubmit(values: ResetPasswordForm) {
    setResettingPassword(true);
    try {
      await resetUserPassword(userId, values);
      message.success(t('admin.users.detail.resetPasswordSuccess'));
      setResetPasswordOpen(false);
      resetPasswordForm.resetFields();
    } catch (error) {
      message.error(getErrorMessage(error));
    } finally {
      setResettingPassword(false);
    }
  }

  async function handleCreateRoleSubmit(values: CreateRoleForm) {
    setCreatingRole(true);
    setCreateRoleError(null);
    try {
      await createUserRole({ user_id: userId, ...values });
      message.success(t('admin.users.detail.roleAssignment.createSuccess'));
      setCreateRoleOpen(false);
      createRoleForm.resetFields();
      loadRoles();
    } catch (error) {
      const resultCode = getResultCode(error);
      if (resultCode === 32001) {
        setCreateRoleError(t('admin.users.detail.roleAssignment.errors.32001'));
      } else {
        setCreateRoleError(getErrorMessage(error));
      }
    } finally {
      setCreatingRole(false);
    }
  }

  async function handleEditRoleSubmit(values: EditRoleForm) {
    if (!editingRole) return;
    setSavingRole(true);
    setEditRoleError(null);
    try {
      await updateUserRole(userId, editingRole.project_id, {
        role_code: values.role_code,
        status: values.status ? 1 : 0,
      });
      message.success(t('admin.users.detail.roleAssignment.updateSuccess'));
      setEditingRole(null);
      loadRoles();
    } catch (error) {
      setEditRoleError(getErrorMessage(error));
    } finally {
      setSavingRole(false);
    }
  }

  function openEditRole(role: UserRole) {
    setEditRoleError(null);
    editRoleForm.setFieldsValue({
      role_code: role.role_code,
      status: role.status === 1,
    });
    setEditingRole(role);
  }

  if (notFound) {
    return (
      <Result
        status="404"
        title={t('admin.users.detail.notFound')}
        extra={
          <Button onClick={() => navigate('/admin/users')}>
            {t('admin.users.backToList')}
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
          <Button onClick={() => navigate('/admin/users')}>
            {t('admin.users.backToList')}
          </Button>
        }
      />
    );
  }

  const requestedProject = user?.requested_project_id
    ? projectList.find((project) => project.project_id === user.requested_project_id)
    : undefined;

  const companyProjectOptions = projectList
    .filter((project) => project.company_id === user?.company_id)
    .map((project) => ({ value: project.project_id, label: project.project_name }));

  return (
    <div>
      <PageHeader
        title={t('admin.users.detail.title', { id: userId })}
        actions={
          <Button onClick={() => navigate('/admin/users')}>
            {t('admin.users.backToList')}
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

        {user && (
          <Card style={{ maxWidth: 640, marginBottom: 16 }}>
            <Descriptions column={1} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('admin.users.fields.loginId')}>
                {user.login_id}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.status')}>
                <UserStatusTag status={user.status} />
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.requestedProject')}>
                {user.requested_project_id
                  ? (requestedProject?.project_name ?? `#${user.requested_project_id}`)
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.lastLoginAt')}>
                {user.last_login_at ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.createdAt')}>
                {user.created_at}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.updatedAt')}>
                {user.updated_at}
              </Descriptions.Item>
            </Descriptions>

            {isSuperAdmin && (
              <Space>
                {user.status === 0 && (
                  <>
                    <Popconfirm
                      title={t('admin.users.detail.approveConfirm')}
                      onConfirm={handleApprove}
                    >
                      <Button type="primary" loading={actionLoading}>
                        {t('admin.users.detail.approve')}
                      </Button>
                    </Popconfirm>
                    <Popconfirm
                      title={t('admin.users.detail.rejectConfirm')}
                      onConfirm={handleReject}
                    >
                      <Button danger loading={actionLoading}>
                        {t('admin.users.detail.reject')}
                      </Button>
                    </Popconfirm>
                  </>
                )}
                {user.status === 1 && (
                  <Popconfirm
                    title={t('admin.users.detail.suspendConfirm')}
                    onConfirm={handleSuspend}
                  >
                    <Button danger loading={actionLoading}>
                      {t('admin.users.detail.suspend')}
                    </Button>
                  </Popconfirm>
                )}
                {user.status === 3 && (
                  <Popconfirm
                    title={t('admin.users.detail.reactivateConfirm')}
                    onConfirm={handleReactivate}
                  >
                    <Button type="primary" loading={actionLoading}>
                      {t('admin.users.detail.reactivate')}
                    </Button>
                  </Popconfirm>
                )}
                {user.status === 2 && (
                  <Popconfirm
                    title={t('admin.users.detail.backToPendingConfirm')}
                    onConfirm={handleBackToPending}
                  >
                    <Button type="primary" loading={actionLoading}>
                      {t('admin.users.detail.backToPending')}
                    </Button>
                  </Popconfirm>
                )}
                <Button onClick={() => setResetPasswordOpen(true)}>
                  {t('admin.users.detail.resetPassword')}
                </Button>
              </Space>
            )}
          </Card>
        )}

        <Card style={{ maxWidth: 640, marginBottom: 16 }}>
          <Form<EditForm>
            form={editForm}
            layout="vertical"
            onFinish={handleEditSubmit}
            disabled={!isSuperAdmin}
          >
            <Form.Item
              name="user_name"
              label={t('admin.users.fields.userName')}
              rules={[{ required: true, max: 100 }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="email"
              label={t('admin.users.fields.email')}
              rules={[{ required: true, type: 'email', max: 200 }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="phone_number"
              label={t('admin.users.fields.phoneNumber')}
              rules={[{ required: true, max: 20 }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="department"
              label={t('admin.users.fields.department')}
              rules={[{ max: 100 }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="position"
              label={t('admin.users.fields.position')}
              rules={[{ max: 100 }]}
            >
              <Input />
            </Form.Item>
            {isSuperAdmin && (
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" loading={saving}>
                  {t('admin.users.detail.save')}
                </Button>
              </Form.Item>
            )}
          </Form>
        </Card>

        {isSuperAdmin && (
          <Card
            style={{ maxWidth: 900, marginBottom: 16 }}
            title={t('admin.users.detail.roleAssignment.title')}
            extra={
              <Button size="small" onClick={() => setCreateRoleOpen(true)}>
                {t('admin.users.detail.roleAssignment.add')}
              </Button>
            }
          >
            <Table<UserRole>
              rowKey="project_id"
              size="small"
              loading={rolesLoading}
              dataSource={roles}
              pagination={false}
              columns={[
                {
                  title: t('admin.users.detail.roleAssignment.project'),
                  dataIndex: 'project_id',
                  render: (value: number) =>
                    projectList.find((project) => project.project_id === value)
                      ?.project_name ?? `#${value}`,
                },
                {
                  title: t('admin.users.detail.roleAssignment.roleCode'),
                  dataIndex: 'role_code',
                  render: (value: number) => <Tag>{roleCodeLabel(value)}</Tag>,
                },
                {
                  title: t('admin.users.fields.status'),
                  dataIndex: 'status',
                  render: (value: number) => (
                    <Tag color={value === 1 ? 'green' : 'default'}>
                      {value === 1
                        ? t('common.status.active')
                        : t('common.status.inactive')}
                    </Tag>
                  ),
                },
                {
                  title: t('admin.users.fields.updatedAt'),
                  dataIndex: 'updated_at',
                },
                {
                  title: '',
                  key: 'actions',
                  render: (_, record) => (
                    <Button size="small" onClick={() => openEditRole(record)}>
                      {t('admin.users.detail.roleAssignment.edit')}
                    </Button>
                  ),
                },
              ]}
            />
          </Card>
        )}
      </Spin>

      <Modal
        open={resetPasswordOpen}
        title={t('admin.users.detail.resetPasswordModalTitle')}
        onCancel={() => setResetPasswordOpen(false)}
        onOk={() => resetPasswordForm.submit()}
        confirmLoading={resettingPassword}
      >
        <Form<ResetPasswordForm>
          form={resetPasswordForm}
          layout="vertical"
          onFinish={handleResetPasswordSubmit}
        >
          <Form.Item
            name="new_password"
            label={t('admin.users.detail.newPassword')}
            rules={[{ required: true, min: 4, max: 72 }]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={createRoleOpen}
        title={t('admin.users.detail.roleAssignment.addModalTitle')}
        onCancel={() => setCreateRoleOpen(false)}
        onOk={() => createRoleForm.submit()}
        confirmLoading={creatingRole}
      >
        {createRoleError && (
          <Alert
            type="error"
            message={createRoleError}
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}
        <Form<CreateRoleForm>
          form={createRoleForm}
          layout="vertical"
          onFinish={handleCreateRoleSubmit}
        >
          <Form.Item
            name="project_id"
            label={t('admin.users.detail.roleAssignment.project')}
            rules={[{ required: true }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={companyProjectOptions}
            />
          </Form.Item>
          <Form.Item
            name="role_code"
            label={t('admin.users.detail.roleAssignment.roleCode')}
            rules={[{ required: true }]}
          >
            <Select options={ASSIGNABLE_ROLE_CODES} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={editingRole !== null}
        title={t('admin.users.detail.roleAssignment.editModalTitle')}
        onCancel={() => setEditingRole(null)}
        onOk={() => editRoleForm.submit()}
        confirmLoading={savingRole}
      >
        {editRoleError && (
          <Alert
            type="error"
            message={editRoleError}
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}
        <Form<EditRoleForm>
          form={editRoleForm}
          layout="vertical"
          onFinish={handleEditRoleSubmit}
        >
          <Form.Item
            name="role_code"
            label={t('admin.users.detail.roleAssignment.roleCode')}
            rules={[{ required: true }]}
          >
            <Select options={ASSIGNABLE_ROLE_CODES} />
          </Form.Item>
          <Form.Item
            name="status"
            label={t('admin.users.fields.status')}
            valuePropName="checked"
          >
            <Switch
              checkedChildren={t('common.status.active')}
              unCheckedChildren={t('common.status.inactive')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
