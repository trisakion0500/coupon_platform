import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Result, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getUser } from '@/api/user';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { PageHeader } from '@/components/common/PageHeader';
import { UserStatusTag } from '@/components/common/UserStatusTag';
import type { User } from '@/types/user';

/**
 * SCR-031 — 순수 조회 전용 1차 구현(2026-07-24). 수정/승인·반려/비밀번호초기화/User Role
 * 관리는 다음 단계에서 이어붙인다. 12_USER_API.md 1.3 — DEVELOPER가 타 회사 사용자를
 * 조회하면 404가 아니라 20001(PERMISSION_DENIED)로 온다(project.getById()와 동일 판단).
 */
export function UserDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user_id } = useParams();
  const userId = Number(user_id);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getUser(userId)
      .then(setUser)
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
  }, [userId]);

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
          <Card style={{ maxWidth: 640 }}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label={t('admin.users.fields.loginId')}>
                {user.login_id}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.userName')}>
                {user.user_name}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.email')}>
                {user.email}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.phoneNumber')}>
                {user.phone_number}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.department')}>
                {user.department ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.position')}>
                {user.position ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('admin.users.fields.status')}>
                <UserStatusTag status={user.status} />
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
          </Card>
        )}
      </Spin>
    </div>
  );
}
