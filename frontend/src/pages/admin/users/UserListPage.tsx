import { useEffect, useState } from 'react';
import { Select, Table } from 'antd';
import type { TablePaginationConfig } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { listUsers } from '@/api/user';
import { PageHeader } from '@/components/common/PageHeader';
import { UserStatusTag } from '@/components/common/UserStatusTag';
import { getErrorMessage } from '@/api/errors';
import { useGlobalStore } from '@/stores/globalStore';
import type { User } from '@/types/user';

const STATUS_FILTER_ALL = 'ALL';

/**
 * SCR-030. 12_USER_API.md 1.1 — 회사 필터는 화면 자체가 아니라 헤더의 전역 회사 선택을
 * 그대로 사용한다(15_SCREEN_LIST.md). DEVELOPER가 보내는 company_id는 서버가 무시하고
 * 본인 소속 회사로 강제 고정하므로, 역할과 무관하게 selectedCompanyId를 그대로 전달해도 안전하다.
 */
export function UserListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selectedCompanyId = useGlobalStore((state) => state.selectedCompanyId);
  const [items, setItems] = useState<User[]>([]);
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
    listUsers({
      page,
      page_size: pageSize,
      status,
      company_id: selectedCompanyId ?? undefined,
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
  }, [page, pageSize, status, selectedCompanyId]);

  function handleTableChange(pagination: TablePaginationConfig) {
    setPage(pagination.current ?? 1);
    setPageSize((pagination.pageSize ?? 20) as 20 | 30 | 50 | 100);
  }

  return (
    <div>
      <PageHeader title={t('nav.admin.users')} />

      <Select
        placeholder={t('admin.users.list.statusFilterPlaceholder')}
        style={{ width: 180, marginBottom: 16 }}
        value={status ?? STATUS_FILTER_ALL}
        onChange={(value) => {
          setStatus(value === STATUS_FILTER_ALL ? undefined : (value as number));
          setPage(1);
        }}
        options={[
          { value: STATUS_FILTER_ALL, label: t('common.filterAll') },
          { value: 0, label: t('admin.users.status.pending') },
          { value: 1, label: t('admin.users.status.active') },
          { value: 2, label: t('admin.users.status.rejected') },
          { value: 3, label: t('admin.users.status.suspended') },
        ]}
      />

      {errorMessage && (
        <div style={{ color: 'red', marginBottom: 16 }}>{errorMessage}</div>
      )}

      <Table<User>
        rowKey="user_id"
        loading={loading}
        dataSource={items}
        onChange={handleTableChange}
        onRow={(record) => ({
          style: { cursor: 'pointer' },
          onClick: () => navigate(`/admin/users/${record.user_id}`),
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
            title: t('admin.users.fields.loginId'),
            dataIndex: 'login_id',
          },
          {
            title: t('admin.users.fields.userName'),
            dataIndex: 'user_name',
          },
          {
            title: t('admin.users.fields.email'),
            dataIndex: 'email',
          },
          {
            title: t('admin.users.fields.department'),
            dataIndex: 'department',
            render: (value: string | null) => value ?? '-',
          },
          {
            title: t('admin.users.fields.position'),
            dataIndex: 'position',
            render: (value: string | null) => value ?? '-',
          },
          {
            title: t('admin.users.fields.status'),
            dataIndex: 'status',
            render: (value: number) => <UserStatusTag status={value} />,
          },
          {
            title: t('admin.users.fields.createdAt'),
            dataIndex: 'created_at',
          },
        ]}
      />
    </div>
  );
}
