import { useEffect, useState } from 'react';
import { DatePicker, Input, Select, Table, Typography } from 'antd';
import type { TablePaginationConfig } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { listCouponUseLogs } from '@/api/coupon-use-log';
import { getErrorMessage } from '@/api/errors';
import { CouponUseActionTag } from '@/components/common/CouponUseActionTag';
import { CouponUseResultTag } from '@/components/common/CouponUseResultTag';
import { PageHeader } from '@/components/common/PageHeader';
import { RequireProjectSelected } from '@/components/guards/RequireProjectSelected';
import { useGlobalStore } from '@/stores/globalStore';
import type {
  CouponUseAction,
  CouponUseLogItem,
  CouponUseResultType,
} from '@/types/coupon-use-log';

const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
const FILTER_ALL = 'ALL';
const ACTIONS: CouponUseAction[] = [10, 20];
const RESULT_TYPES: CouponUseResultType[] = [0, 10, 20, 30, 40, 50];

/** SCR-103. */
export function CouponUseLogsPage() {
  return (
    <RequireProjectSelected>
      <CouponUseLogsContent />
    </RequireProjectSelected>
  );
}

/** RequireProjectSelected가 감싸고 있어 이 컴포넌트가 렌더될 때는 항상 selectedProjectId가 있다. */
function CouponUseLogsContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selectedProjectId = useGlobalStore((state) => state.selectedProjectId)!;
  const [items, setItems] = useState<CouponUseLogItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 30 | 50 | 100>(20);
  const [couponCampaignId, setCouponCampaignId] = useState<number | undefined>(undefined);
  const [gameUserId, setGameUserId] = useState<string | undefined>(undefined);
  const [codeValue, setCodeValue] = useState<string | undefined>(undefined);
  const [action, setAction] = useState<CouponUseAction | undefined>(undefined);
  const [resultType, setResultType] = useState<CouponUseResultType | undefined>(undefined);
  const [period, setPeriod] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    listCouponUseLogs({
      project_id: selectedProjectId,
      page,
      page_size: pageSize,
      coupon_campaign_id: couponCampaignId,
      game_user_id: gameUserId,
      code_value: codeValue,
      action,
      result_type: resultType,
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
  }, [
    selectedProjectId,
    page,
    pageSize,
    couponCampaignId,
    gameUserId,
    codeValue,
    action,
    resultType,
    period,
  ]);

  function handleTableChange(pagination: TablePaginationConfig) {
    setPage(pagination.current ?? 1);
    setPageSize((pagination.pageSize ?? 20) as 20 | 30 | 50 | 100);
  }

  function handleCampaignIdSearch(value: string) {
    const trimmed = value.trim();
    const parsed = trimmed ? Number(trimmed) : NaN;
    setCouponCampaignId(Number.isFinite(parsed) ? parsed : undefined);
    setPage(1);
  }

  return (
    <div>
      <PageHeader title={t('nav.couponUseLogs')} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input.Search
          placeholder={t('couponUseLogs.list.campaignIdPlaceholder')}
          style={{ width: 160 }}
          allowClear
          onSearch={handleCampaignIdSearch}
        />
        <Input.Search
          placeholder={t('couponUseLogs.list.gameUserIdPlaceholder')}
          style={{ width: 200 }}
          allowClear
          maxLength={100}
          onSearch={(value) => {
            setGameUserId(value || undefined);
            setPage(1);
          }}
        />
        <Input.Search
          placeholder={t('couponUseLogs.list.codeValuePlaceholder')}
          style={{ width: 200 }}
          allowClear
          maxLength={50}
          onSearch={(value) => {
            setCodeValue(value || undefined);
            setPage(1);
          }}
        />
        <Select
          placeholder={t('couponUseLogs.list.actionFilterPlaceholder')}
          style={{ width: 140 }}
          value={action ?? FILTER_ALL}
          onChange={(value) => {
            setAction(value === FILTER_ALL ? undefined : (value as CouponUseAction));
            setPage(1);
          }}
          options={[
            { value: FILTER_ALL, label: t('common.filterAll') },
            ...ACTIONS.map((value) => ({
              value,
              label: t(`couponUseLogs.actions.${value}`),
            })),
          ]}
        />
        <Select
          placeholder={t('couponUseLogs.list.resultTypeFilterPlaceholder')}
          style={{ width: 160 }}
          value={resultType ?? FILTER_ALL}
          onChange={(value) => {
            setResultType(value === FILTER_ALL ? undefined : (value as CouponUseResultType));
            setPage(1);
          }}
          options={[
            { value: FILTER_ALL, label: t('common.filterAll') },
            ...RESULT_TYPES.map((value) => ({
              value,
              label: t(`couponUseLogs.resultTypes.${value}`),
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

      <Table<CouponUseLogItem>
        rowKey="idx"
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
          { title: t('couponUseLogs.fields.createdAt'), dataIndex: 'created_at' },
          {
            title: t('couponUseLogs.fields.action'),
            dataIndex: 'action',
            render: (value: CouponUseAction) => <CouponUseActionTag action={value} />,
          },
          {
            title: t('couponUseLogs.fields.campaign'),
            render: (_, record) =>
              record.coupon_campaign_id !== null ? (
                <Typography.Link onClick={() => navigate(`/campaigns/${record.coupon_campaign_id}`)}>
                  {record.campaign_name ?? `#${record.coupon_campaign_id}`}
                </Typography.Link>
              ) : (
                '-'
              ),
          },
          { title: t('couponUseLogs.fields.codeValue'), dataIndex: 'code_value' },
          { title: t('couponUseLogs.fields.gameUserId'), dataIndex: 'game_user_id' },
          {
            title: t('couponUseLogs.fields.resultType'),
            dataIndex: 'result_type',
            render: (value: CouponUseResultType) => <CouponUseResultTag resultType={value} />,
          },
          {
            title: t('couponUseLogs.fields.callerIp'),
            dataIndex: 'caller_ip',
            render: (value: string | null) => value ?? '-',
          },
        ]}
      />
    </div>
  );
}
