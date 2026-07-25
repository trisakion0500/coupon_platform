import { useEffect, useState } from 'react';
import { Button, Select, Table, Typography } from 'antd';
import type { TablePaginationConfig } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { listCampaigns } from '@/api/campaign';
import { getErrorMessage } from '@/api/errors';
import { ApprovalStatusTag } from '@/components/common/ApprovalStatusTag';
import { CampaignStatusTag } from '@/components/common/CampaignStatusTag';
import { GenerationStatusTag } from '@/components/common/GenerationStatusTag';
import { PageHeader } from '@/components/common/PageHeader';
import { RequireProjectSelected } from '@/components/guards/RequireProjectSelected';
import { isCampaignExpired } from '@/lib/campaignPeriod';
import { useGlobalStore } from '@/stores/globalStore';
import type { CampaignListItem } from '@/types/campaign';

const FILTER_ALL = 'ALL';

/** SCR-100. */
export function CampaignListPage() {
  return (
    <RequireProjectSelected>
      <CampaignListContent />
    </RequireProjectSelected>
  );
}

/** RequireProjectSelected가 감싸고 있어 이 컴포넌트가 렌더될 때는 항상 selectedProjectId가 있다. */
function CampaignListContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selectedProjectId = useGlobalStore((state) => state.selectedProjectId)!;
  const [items, setItems] = useState<CampaignListItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 30 | 50 | 100>(20);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [approvalStatus, setApprovalStatus] = useState<number | undefined>(undefined);
  const [generationStatus, setGenerationStatus] = useState<number | undefined>(undefined);
  const [codeType, setCodeType] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    listCampaigns({
      project_id: selectedProjectId,
      page,
      page_size: pageSize,
      status,
      approval_status: approvalStatus,
      generation_status: generationStatus,
      code_type: codeType,
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
  }, [selectedProjectId, page, pageSize, status, approvalStatus, generationStatus, codeType]);

  function handleTableChange(pagination: TablePaginationConfig) {
    setPage(pagination.current ?? 1);
    setPageSize((pagination.pageSize ?? 20) as 20 | 30 | 50 | 100);
  }

  return (
    <div>
      <PageHeader
        title={t('nav.campaigns')}
        actions={
          <Button type="primary" onClick={() => navigate('/campaigns/new')}>
            {t('campaigns.list.create')}
          </Button>
        }
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Select
          placeholder={t('campaigns.list.statusFilterPlaceholder')}
          style={{ width: 140 }}
          value={status ?? FILTER_ALL}
          onChange={(value) => {
            setStatus(value === FILTER_ALL ? undefined : (value as number));
            setPage(1);
          }}
          options={[
            { value: FILTER_ALL, label: t('common.filterAll') },
            { value: 1, label: t('campaigns.status.1') },
            { value: 2, label: t('campaigns.status.2') },
            { value: 3, label: t('campaigns.status.3') },
            { value: 4, label: t('campaigns.status.4') },
          ]}
        />
        <Select
          placeholder={t('campaigns.list.approvalStatusFilterPlaceholder')}
          style={{ width: 140 }}
          value={approvalStatus ?? FILTER_ALL}
          onChange={(value) => {
            setApprovalStatus(value === FILTER_ALL ? undefined : (value as number));
            setPage(1);
          }}
          options={[
            { value: FILTER_ALL, label: t('common.filterAll') },
            { value: 1, label: t('campaigns.approvalStatus.1') },
            { value: 2, label: t('campaigns.approvalStatus.2') },
            { value: 3, label: t('campaigns.approvalStatus.3') },
            { value: 4, label: t('campaigns.approvalStatus.4') },
          ]}
        />
        <Select
          placeholder={t('campaigns.list.generationStatusFilterPlaceholder')}
          style={{ width: 140 }}
          value={generationStatus ?? FILTER_ALL}
          onChange={(value) => {
            setGenerationStatus(value === FILTER_ALL ? undefined : (value as number));
            setPage(1);
          }}
          options={[
            { value: FILTER_ALL, label: t('common.filterAll') },
            { value: 1, label: t('campaigns.generationStatus.1') },
            { value: 2, label: t('campaigns.generationStatus.2') },
            { value: 3, label: t('campaigns.generationStatus.3') },
            { value: 4, label: t('campaigns.generationStatus.4') },
          ]}
        />
        <Select
          placeholder={t('campaigns.list.codeTypeFilterPlaceholder')}
          style={{ width: 140 }}
          value={codeType ?? FILTER_ALL}
          onChange={(value) => {
            setCodeType(value === FILTER_ALL ? undefined : (value as number));
            setPage(1);
          }}
          options={[
            { value: FILTER_ALL, label: t('common.filterAll') },
            { value: 1, label: t('campaigns.codeType.1') },
            { value: 2, label: t('campaigns.codeType.2') },
          ]}
        />
      </div>

      {errorMessage && (
        <div style={{ color: 'red', marginBottom: 16 }}>{errorMessage}</div>
      )}

      <Table<CampaignListItem>
        rowKey="coupon_campaign_id"
        loading={loading}
        dataSource={items}
        onChange={handleTableChange}
        onRow={(record) => ({
          style: { cursor: 'pointer' },
          onClick: () => navigate(`/campaigns/${record.coupon_campaign_id}`),
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
            title: t('campaigns.fields.name'),
            dataIndex: 'name',
          },
          {
            title: t('campaigns.fields.codeType'),
            dataIndex: 'code_type',
            render: (value: number) => t(`campaigns.codeType.${value}`),
          },
          {
            title: t('campaigns.fields.status'),
            dataIndex: 'status',
            render: (value: number) => <CampaignStatusTag status={value} />,
          },
          {
            title: t('campaigns.fields.approvalStatus'),
            dataIndex: 'approval_status',
            render: (value: number) => <ApprovalStatusTag approvalStatus={value} />,
          },
          {
            title: t('campaigns.fields.generationStatus'),
            dataIndex: 'generation_status',
            render: (value: number) => <GenerationStatusTag generationStatus={value} />,
          },
          {
            title: t('campaigns.fields.qty'),
            render: (_, record) => `${record.generated_qty}/${record.requested_qty}`,
          },
          {
            title: t('campaigns.fields.usableQty'),
            dataIndex: 'usable_qty',
          },
          {
            title: t('campaigns.fields.usedQty'),
            dataIndex: 'used_qty',
          },
          {
            title: t('campaigns.fields.period'),
            render: (_, record) => (
              <>
                {record.campaign_start} ~{' '}
                {isCampaignExpired(record.campaign_end) ? (
                  <Typography.Text type="danger">{record.campaign_end}</Typography.Text>
                ) : (
                  record.campaign_end
                )}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
