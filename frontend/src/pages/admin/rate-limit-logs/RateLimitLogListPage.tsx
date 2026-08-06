import { useEffect, useState } from 'react';
import { DatePicker, Input, Select, Table } from 'antd';
import type { TablePaginationConfig } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { listRateLimitLogs } from '@/api/rate-limit-log';
import { getErrorMessage } from '@/api/errors';
import { CouponUseActionTag } from '@/components/common/CouponUseActionTag';
import { PageHeader } from '@/components/common/PageHeader';
import { RateLimitScopeTag } from '@/components/common/RateLimitScopeTag';
import { useGlobalStore } from '@/stores/globalStore';
import type {
  RateLimitLogItem,
  RateLimitScope,
} from '@/types/rate-limit-log';
import type { CouponUseAction } from '@/types/coupon-use-log';

const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
const FILTER_ALL = 'ALL';
const LIMIT_SCOPES: RateLimitScope[] = [10, 20];
const ACTIONS: CouponUseAction[] = [10, 20];

/**
 * SCR-042. 16_MENU_PERMISSION.md 2.6 — 회사 필터는 화면 자체가 아닌 헤더의 전역 회사 선택을
 * 그대로 사용(AuditLogListPage와 동일 구조), 화면에는 리밋종류/작업유형/게임유저ID/기간 필터만
 * 노출한다. 목록 1개 화면으로 충분해(before/after JSON 같은 상세 전용 데이터가 없음) 상세 화면은
 * 두지 않는다.
 */
export function RateLimitLogListPage() {
  const { t } = useTranslation();
  const selectedCompanyId = useGlobalStore((state) => state.selectedCompanyId);
  const companyList = useGlobalStore((state) => state.companyList);
  const projectList = useGlobalStore((state) => state.projectList);
  const [items, setItems] = useState<RateLimitLogItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 30 | 50 | 100>(20);
  const [limitScope, setLimitScope] = useState<RateLimitScope | undefined>(undefined);
  const [action, setAction] = useState<CouponUseAction | undefined>(undefined);
  const [gameUserId, setGameUserId] = useState<string | undefined>(undefined);
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
    listRateLimitLogs({
      page,
      page_size: pageSize,
      company_id: selectedCompanyId ?? undefined,
      limit_scope: limitScope,
      action,
      game_user_id: gameUserId,
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
  }, [page, pageSize, selectedCompanyId, limitScope, action, gameUserId, period]);

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
      <PageHeader title={t('nav.admin.rateLimitLogs')} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Select
          placeholder={t('admin.rateLimitLogs.list.limitScopeFilterPlaceholder')}
          style={{ width: 160 }}
          value={limitScope ?? FILTER_ALL}
          onChange={(value) => {
            setLimitScope(value === FILTER_ALL ? undefined : (value as RateLimitScope));
            setPage(1);
          }}
          options={[
            { value: FILTER_ALL, label: t('common.filterAll') },
            ...LIMIT_SCOPES.map((value) => ({
              value,
              label: t(`admin.rateLimitLogs.scopes.${value}`),
            })),
          ]}
        />
        <Select
          placeholder={t('admin.rateLimitLogs.list.actionFilterPlaceholder')}
          style={{ width: 160 }}
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
        <Input.Search
          placeholder={t('admin.rateLimitLogs.list.gameUserIdPlaceholder')}
          style={{ width: 200 }}
          allowClear
          maxLength={100}
          onSearch={(value) => {
            setGameUserId(value || undefined);
            setPage(1);
          }}
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

      <Table<RateLimitLogItem>
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
          { title: t('admin.rateLimitLogs.fields.createdAt'), dataIndex: 'created_at' },
          {
            title: t('admin.rateLimitLogs.fields.limitScope'),
            dataIndex: 'limit_scope',
            render: (value: RateLimitScope) => <RateLimitScopeTag scope={value} />,
          },
          {
            title: t('admin.rateLimitLogs.fields.action'),
            dataIndex: 'action',
            render: (value: CouponUseAction) => <CouponUseActionTag action={value} />,
          },
          {
            title: t('admin.rateLimitLogs.fields.company'),
            dataIndex: 'company_id',
            render: (value: number | null) => companyName(value),
          },
          {
            title: t('admin.rateLimitLogs.fields.project'),
            dataIndex: 'project_id',
            render: (value: number | null) => projectName(value),
          },
          {
            title: t('admin.rateLimitLogs.fields.gameUserId'),
            dataIndex: 'game_user_id',
            render: (value: string | null) => value ?? '-',
          },
          { title: t('admin.rateLimitLogs.fields.apiKey'), dataIndex: 'api_key' },
          {
            title: t('admin.rateLimitLogs.fields.retryAfterSec'),
            dataIndex: 'retry_after_sec',
          },
          {
            title: t('admin.rateLimitLogs.fields.callerIp'),
            dataIndex: 'caller_ip',
            render: (value: string | null) => value ?? '-',
          },
        ]}
      />
    </div>
  );
}
