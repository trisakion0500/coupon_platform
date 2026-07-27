import { useEffect, useState } from 'react';
import { Button, Select, Table } from 'antd';
import type { TablePaginationConfig } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { listCompanies } from '@/api/company';
import { ActiveStatusTag } from '@/components/common/ActiveStatusTag';
import { PageHeader } from '@/components/common/PageHeader';
import { getErrorMessage } from '@/api/errors';
import type { Company } from '@/types/company';

const STATUS_FILTER_ALL = 'ALL';

/** SCR-010. 12_COMPANY_API.md 2.2. */
export function CompanyListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [items, setItems] = useState<Company[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 30 | 50 | 100>(20);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    listCompanies({ page, page_size: pageSize, status })
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
  }, [page, pageSize, status]);

  function handleTableChange(pagination: TablePaginationConfig) {
    setPage(pagination.current ?? 1);
    setPageSize((pagination.pageSize ?? 20) as 20 | 30 | 50 | 100);
  }

  return (
    <div>
      <PageHeader
        title={t('nav.admin.companies')}
        actions={
          <Button type="primary" onClick={() => navigate('/admin/companies/new')}>
            {t('admin.companies.list.create')}
          </Button>
        }
      />

      <Select
        placeholder={t('admin.companies.list.statusFilterPlaceholder')}
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

      <Table<Company>
        rowKey="company_id"
        loading={loading}
        dataSource={items}
        onChange={handleTableChange}
        onRow={(record) => ({
          style: { cursor: 'pointer' },
          onClick: () => navigate(`/admin/companies/${record.company_id}`),
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
            title: t('admin.companies.fields.companyCode'),
            dataIndex: 'company_code',
          },
          {
            title: t('admin.companies.fields.companyName'),
            dataIndex: 'company_name',
          },
          {
            title: t('admin.companies.fields.description'),
            dataIndex: 'description',
            render: (value: string | null) => value ?? '-',
          },
          {
            title: t('admin.companies.fields.status'),
            dataIndex: 'status',
            render: (value: number) => <ActiveStatusTag status={value} />,
          },
          {
            title: t('admin.companies.fields.createdAt'),
            dataIndex: 'created_at',
          },
        ]}
      />
    </div>
  );
}
