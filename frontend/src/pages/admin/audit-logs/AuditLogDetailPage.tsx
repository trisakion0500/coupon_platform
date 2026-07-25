import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Result, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { getAuditLog } from '@/api/audit-log';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { AuditActionTag } from '@/components/common/AuditActionTag';
import { PageHeader } from '@/components/common/PageHeader';
import { useGlobalStore } from '@/stores/globalStore';
import type { AuditLogDetail } from '@/types/audit-log';

function JsonBlock({ value }: { value: Record<string, unknown> | null }) {
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        background: '#f5f5f5',
        borderRadius: 4,
        overflowX: 'auto',
        fontSize: 12,
      }}
    >
      {value === null ? '-' : JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** SCR-041. 13_LOG_AUDIT_API.md 6장. */
export function AuditLogDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { idx } = useParams();
  const logIdx = Number(idx);
  const companyList = useGlobalStore((state) => state.companyList);
  const projectList = useGlobalStore((state) => state.projectList);
  const [log, setLog] = useState<AuditLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getAuditLog(logIdx)
      .then(setLog)
      .catch((error: unknown) => {
        const resultCode = getResultCode(error);
        if (resultCode === 31008) {
          setNotFound(true);
        } else if (resultCode === 20001) {
          setForbidden(true);
        } else {
          setErrorMessage(getErrorMessage(error));
        }
      })
      .finally(() => setLoading(false));
  }, [logIdx]);

  if (notFound) {
    return (
      <Result
        status="404"
        title={t('admin.auditLogs.detail.notFound')}
        extra={
          <Button onClick={() => navigate('/admin/audit-logs')}>
            {t('admin.auditLogs.backToList')}
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
          <Button onClick={() => navigate('/admin/audit-logs')}>
            {t('admin.auditLogs.backToList')}
          </Button>
        }
      />
    );
  }

  const companyName = log?.company_id
    ? (companyList.find((c) => c.company_id === log.company_id)?.company_name ??
      `#${log.company_id}`)
    : '-';
  const projectName = log?.project_id
    ? (projectList.find((p) => p.project_id === log.project_id)?.project_name ??
      `#${log.project_id}`)
    : '-';

  return (
    <div>
      <PageHeader
        title={t('admin.auditLogs.detail.title', { id: logIdx })}
        actions={
          <Button onClick={() => navigate('/admin/audit-logs')}>
            {t('admin.auditLogs.backToList')}
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

        {log && (
          <>
            <Card style={{ maxWidth: 720, marginBottom: 16 }}>
              <Descriptions column={1} size="small">
                <Descriptions.Item label={t('admin.auditLogs.fields.tableName')}>
                  {t(`admin.auditLogs.tableNames.${log.table_name}`)}
                </Descriptions.Item>
                <Descriptions.Item label={t('admin.auditLogs.fields.target')}>
                  {log.target_name ?? `#${log.target_id}`}
                </Descriptions.Item>
                <Descriptions.Item label={t('admin.auditLogs.fields.action')}>
                  <AuditActionTag action={log.action} />
                </Descriptions.Item>
                <Descriptions.Item label={t('admin.auditLogs.fields.company')}>
                  {companyName}
                </Descriptions.Item>
                <Descriptions.Item label={t('admin.auditLogs.fields.project')}>
                  {projectName}
                </Descriptions.Item>
                <Descriptions.Item label={t('admin.auditLogs.fields.createdByName')}>
                  {log.created_by_name ?? '-'}
                </Descriptions.Item>
                <Descriptions.Item label={t('admin.auditLogs.fields.createdAt')}>
                  {log.created_at}
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <Card
                title={t('admin.auditLogs.fields.beforeJson')}
                style={{ flex: '1 1 360px', minWidth: 320 }}
              >
                <JsonBlock value={log.before_json} />
              </Card>
              <Card
                title={t('admin.auditLogs.fields.afterJson')}
                style={{ flex: '1 1 360px', minWidth: 320 }}
              >
                <JsonBlock value={log.after_json} />
              </Card>
            </div>
          </>
        )}
      </Spin>
    </div>
  );
}
