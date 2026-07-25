import { useEffect, useState } from 'react';
import { Input, Select, Table, Tag } from 'antd';
import type { TablePaginationConfig } from 'antd';
import { useTranslation } from 'react-i18next';
import { listUsages } from '@/api/campaign';
import { getErrorMessage } from '@/api/errors';
import type { CampaignUsage } from '@/types/campaign';

const FILTER_ALL = 'ALL';

/** SCR-102 탭 3(사용 이력). 17_CAMPAIGN_API.md 4.1 — 조회 전용, 종료된 캠페인도 계속 조회 가능. */
export function CampaignUsagesTab({ campaignId }: { campaignId: number }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<CampaignUsage[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 30 | 50 | 100>(20);
  const [gameUserId, setGameUserId] = useState('');
  const [confirmed, setConfirmed] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    listUsages(campaignId, {
      page,
      page_size: pageSize,
      game_user_id: gameUserId || undefined,
      confirmed,
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
  }, [campaignId, page, pageSize, gameUserId, confirmed]);

  function handleTableChange(pagination: TablePaginationConfig) {
    setPage(pagination.current ?? 1);
    setPageSize((pagination.pageSize ?? 20) as 20 | 30 | 50 | 100);
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input.Search
          placeholder={t('campaigns.usages.gameUserIdPlaceholder')}
          style={{ width: 200 }}
          allowClear
          onSearch={(value) => {
            setGameUserId(value);
            setPage(1);
          }}
        />
        <Select
          placeholder={t('campaigns.usages.confirmedFilterPlaceholder')}
          style={{ width: 160 }}
          value={confirmed ?? FILTER_ALL}
          onChange={(value) => {
            setConfirmed(value === FILTER_ALL ? undefined : (value as number));
            setPage(1);
          }}
          options={[
            { value: FILTER_ALL, label: t('common.filterAll') },
            { value: 0, label: t('campaigns.usages.unconfirmedOnly') },
            { value: 1, label: t('campaigns.usages.confirmedOnly') },
          ]}
        />
      </div>

      {errorMessage && (
        <div style={{ color: 'red', marginBottom: 16 }}>{errorMessage}</div>
      )}

      <Table<CampaignUsage>
        rowKey="coupon_code_usage_id"
        loading={loading}
        dataSource={items}
        onChange={handleTableChange}
        pagination={{
          current: page,
          pageSize,
          total: totalCount,
          showSizeChanger: true,
          pageSizeOptions: ['20', '30', '50', '100'],
        }}
        columns={[
          { title: t('campaigns.usages.fields.codeValue'), dataIndex: 'code_value' },
          { title: t('campaigns.usages.fields.gameUserId'), dataIndex: 'game_user_id' },
          {
            title: t('campaigns.usages.fields.confirmedAt'),
            dataIndex: 'confirmed_at',
            render: (value: string | null) =>
              value ?? <Tag color="gold">{t('campaigns.usages.unconfirmed')}</Tag>,
          },
          { title: t('campaigns.usages.fields.createdAt'), dataIndex: 'created_at' },
        ]}
      />
    </div>
  );
}
