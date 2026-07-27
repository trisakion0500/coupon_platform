import { useEffect, useState } from 'react';
import { Button, Select, Table, Typography } from 'antd';
import type { TablePaginationConfig } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { listProjects } from '@/api/project';
import { ActiveStatusTag } from '@/components/common/ActiveStatusTag';
import { PageHeader } from '@/components/common/PageHeader';
import { getErrorMessage } from '@/api/errors';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalStore } from '@/stores/globalStore';
import { RoleCode } from '@/types/role';
import type { Project } from '@/types/project';

const STATUS_FILTER_ALL = 'ALL';

/**
 * SCR-020. 13_PROJECT_API.md 2.2 — DEVELOPER 스코핑은 회사가 아니라 실제 배정된 `user_role`
 * 기준이라(2026-07-24), 헤더의 전역 회사 선택은 SUPER_ADMIN에게만 추가 필터로 적용한다 —
 * DEVELOPER에게 적용하면 혹시 다른 회사 프로젝트에 예외적으로 배정된 경우를 가려버린다.
 */
export function ProjectListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roleCode = useAuthStore((state) => state.roleCode);
  const isSuperAdmin = roleCode === RoleCode.SUPER_ADMIN;
  const selectedCompanyId = useGlobalStore((state) => state.selectedCompanyId);
  const [items, setItems] = useState<Project[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 30 | 50 | 100>(20);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [selectedCompanyId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    listProjects({
      page,
      page_size: pageSize,
      status,
      company_id: isSuperAdmin ? (selectedCompanyId ?? undefined) : undefined,
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
  }, [page, pageSize, status, selectedCompanyId, isSuperAdmin]);

  function handleTableChange(pagination: TablePaginationConfig) {
    setPage(pagination.current ?? 1);
    setPageSize((pagination.pageSize ?? 20) as 20 | 30 | 50 | 100);
  }

  return (
    <div>
      <PageHeader
        title={t('nav.admin.projects')}
        actions={
          isSuperAdmin ? (
            <Button type="primary" onClick={() => navigate('/admin/projects/new')}>
              {t('admin.projects.list.create')}
            </Button>
          ) : undefined
        }
      />

      <Select
        placeholder={t('admin.projects.list.statusFilterPlaceholder')}
        style={{ width: 160, marginBottom: 16 }}
        value={status ?? STATUS_FILTER_ALL}
        onChange={(value) => {
          setStatus(value === STATUS_FILTER_ALL ? undefined : (value as number));
          setPage(1);
        }}
        options={[
          { value: STATUS_FILTER_ALL, label: t('common.filterAll') },
          { value: 1, label: t('common.status.active') },
          { value: 0, label: t('common.status.inactive') },
        ]}
      />

      {errorMessage && (
        <div style={{ color: 'red', marginBottom: 16 }}>{errorMessage}</div>
      )}

      <Table<Project>
        rowKey="project_id"
        loading={loading}
        dataSource={items}
        onChange={handleTableChange}
        onRow={(record) => ({
          style: { cursor: 'pointer' },
          onClick: () => navigate(`/admin/projects/${record.project_id}`),
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
            title: t('admin.projects.fields.companyName'),
            dataIndex: 'company_name',
          },
          {
            title: t('admin.projects.fields.projectCode'),
            dataIndex: 'project_code',
          },
          {
            title: t('admin.projects.fields.projectName'),
            dataIndex: 'project_name',
          },
          {
            title: t('admin.projects.fields.apiKey'),
            dataIndex: 'api_key',
            render: (value: string) => (
              <Typography.Text code copyable style={{ fontSize: 12 }}>
                {value}
              </Typography.Text>
            ),
          },
          {
            title: t('admin.projects.fields.status'),
            dataIndex: 'status',
            render: (value: number) => <ActiveStatusTag status={value} />,
          },
          {
            title: t('admin.projects.fields.createdAt'),
            dataIndex: 'created_at',
          },
        ]}
      />
    </div>
  );
}
