import { useEffect, useState } from 'react';
import { DatePicker, Select, Table } from 'antd';
import type { TablePaginationConfig } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { listAuditLogs } from '@/api/audit-log';
import { getErrorMessage } from '@/api/errors';
import { AuditActionTag } from '@/components/common/AuditActionTag';
import { PageHeader } from '@/components/common/PageHeader';
import { useGlobalStore } from '@/stores/globalStore';
import type { AuditAction, AuditLogListItem, AuditTableName } from '@/types/audit-log';

const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
const TABLE_NAMES: AuditTableName[] = ['company', 'project', 'user', 'user_role'];
const ACTIONS: AuditAction[] = [10, 20, 30];
const FILTER_ALL = 'ALL';

/**
 * SCR-040. 15_LOG_AUDIT_API.md 5장 — 회사 필터는 화면 자체가 아닌 헤더의 전역 회사 선택을
 * 그대로 사용(17_SCREEN_LIST.md SCR-040), 화면에는 테이블/작업유형/기간 필터만 노출한다.
 */
export function AuditLogListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selectedCompanyId = useGlobalStore((state) => state.selectedCompanyId);
  const companyList = useGlobalStore((state) => state.companyList);
  const projectList = useGlobalStore((state) => state.projectList);
  const [items, setItems] = useState<AuditLogListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 30 | 50 | 100>(20);
  const [tableName, setTableName] = useState<AuditTableName | undefined>(undefined);
  const [action, setAction] = useState<AuditAction | undefined>(undefined);
  const [period, setPeriod] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [selectedCompanyId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    listAuditLogs({
      page,
      page_size: pageSize,
      company_id: selectedCompanyId ?? undefined,
      table_name: tableName,
      action,
      from_created_at: period?.[0] ? period[0].format(DATETIME_FORMAT) : undefined,
      to_created_at: period?.[1] ? period[1].format(DATETIME_FORMAT) : undefined,
    })
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setTotalCount(result.total_count);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(getErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, selectedCompanyId, tableName, action, period]);

  function handleTableChange(pagination: TablePaginationConfig) {
    setPage(pagination.current ?? 1);
    setPageSize((pagination.pageSize ?? 20) as 20 | 30 | 50 | 100);
  }

  function companyName(companyId: number | null): string {
    if (companyId === null) return '-';
    return companyList.find((c) => c.company_id === companyId)?.company_name ?? `#${companyId}`;
  }

  function projectName(projectId: number | null): string {
    if (projectId === null) return '-';
    return projectList.find((p) => p.project_id === projectId)?.project_name ?? `#${projectId}`;
  }

  return (
    <div>
      <PageHeader title={t('nav.admin.auditLogs')} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Select
          placeholder={t('admin.auditLogs.list.tableNameFilterPlaceholder')}
          style={{ width: 160 }}
          value={tableName ?? FILTER_ALL}
          onChange={(value) => {
            setTableName(value === FILTER_ALL ? undefined : (value as AuditTableName));
            setPage(1);
          }}
          options={[
            { value: FILTER_ALL, label: t('common.filterAll') },
            ...TABLE_NAMES.map((name) => ({
              value: name,
              label: t(`admin.auditLogs.tableNames.${name}`),
            })),
          ]}
        />
        <Select
          placeholder={t('admin.auditLogs.list.actionFilterPlaceholder')}
          style={{ width: 160 }}
          value={action ?? FILTER_ALL}
          onChange={(value) => {
            setAction(value === FILTER_ALL ? undefined : (value as AuditAction));
            setPage(1);
          }}
          options={[
            { value: FILTER_ALL, label: t('common.filterAll') },
            ...ACTIONS.map((value) => ({
              value,
              label: t(`admin.auditLogs.actions.${value}`),
            })),
          ]}
        />
        <DatePicker.RangePicker
          showTime
          format={DATETIME_FORMAT}
          value={period}
          onChange={(value) => {
            setPeriod(value as [dayjs.Dayjs | null, dayjs.Dayjs | null] | null);
            setPage(1);
          }}
        />
      </div>

      {errorMessage && (
        <div style={{ color: 'red', marginBottom: 16 }}>{errorMessage}</div>
      )}

      <Table<AuditLogListItem>
        rowKey="idx"
        loading={loading}
        dataSource={items}
        onChange={handleTableChange}
        onRow={(record) => ({
          style: { cursor: 'pointer' },
          onClick: () => navigate(`/admin/audit-logs/${record.idx}`),
        })}
        pagination={{
          current: page,
          pageSize,
          total: totalCount,
          showSizeChanger: true,
          pageSizeOptions: ['20', '30', '50', '100'],
        }}
        columns={[
          {
            title: t('admin.auditLogs.fields.tableName'),
            dataIndex: 'table_name',
            render: (value: AuditTableName) => t(`admin.auditLogs.tableNames.${value}`),
          },
          {
            title: t('admin.auditLogs.fields.target'),
            render: (_, record) => record.target_name ?? `#${record.target_id}`,
          },
          {
            title: t('admin.auditLogs.fields.action'),
            dataIndex: 'action',
            render: (value: AuditAction) => <AuditActionTag action={value} />,
          },
          {
            title: t('admin.auditLogs.fields.company'),
            dataIndex: 'company_id',
            render: (value: number | null) => companyName(value),
          },
          {
            title: t('admin.auditLogs.fields.project'),
            dataIndex: 'project_id',
            render: (value: number | null) => projectName(value),
          },
          {
            title: t('admin.auditLogs.fields.createdByName'),
            dataIndex: 'created_by_name',
            render: (value: string | null) => value ?? '-',
          },
          {
            title: t('admin.auditLogs.fields.createdAt'),
            dataIndex: 'created_at',
          },
        ]}
      />
    </div>
  );
}
