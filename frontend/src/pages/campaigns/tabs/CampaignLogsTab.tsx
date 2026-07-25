import { useEffect, useState } from 'react';
import { Select, Table, Tag } from 'antd';
import type { TablePaginationConfig } from 'antd';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { listCampaignLogs } from '@/api/campaign';
import { getErrorMessage } from '@/api/errors';
import type { CampaignLog } from '@/types/campaign';

const FILTER_ALL = 'ALL';
const ACTIONS = [10, 20, 30, 40, 50];
const CREATE_ACTION = 10;

/**
 * 인접한 두 로그 행(현재 행 vs 시간순 바로 다음 항목 = DESC 정렬이라 배열상 다음 인덱스)을
 * 비교해 바뀐 필드만 뽑아낸다. `log_coupon_campaign`은 매 액션마다 전체 스냅샷이라 서버가
 * diff를 계산해주지 않으므로 프론트가 인접 행을 비교한다(17_CAMPAIGN_API.md 4.2).
 * 현재 페이지에 로드된 항목끼리만 비교한다 — 페이지 경계를 넘는 비교는 하지 않는다(마지막
 * 행이 그 페이지의 가장 오래된 항목이면 "-"로 표시, 전체 이력의 최초 생성 행(action=CREATE)만
 * 항상 비교 대상이 없다). `action` 필터가 걸려있을 때는 이 함수를 호출하지 않는다 — 필터링된
 * 배열의 인접 인덱스가 실제 시간순 직전 로그가 아닐 수 있어(중간 행이 필터로 걸러졌을 수 있음)
 * 비교 자체가 부정확해지기 때문(테이블 렌더 쪽의 `action !== undefined` 분기 참고).
 */
function diffLogs(current: CampaignLog, previous: CampaignLog, t: TFunction): string[] {
  const changes: string[] = [];

  if (current.name !== previous.name) {
    changes.push(`${t('campaigns.fields.name')}: ${previous.name} → ${current.name}`);
  }
  if (current.campaign_start !== previous.campaign_start || current.campaign_end !== previous.campaign_end) {
    changes.push(
      `${t('campaigns.fields.period')}: ${previous.campaign_start}~${previous.campaign_end} → ${current.campaign_start}~${current.campaign_end}`,
    );
  }
  if (current.use_limit_per_user !== previous.use_limit_per_user) {
    changes.push(
      `${t('campaigns.fields.useLimitPerUser')}: ${previous.use_limit_per_user} → ${current.use_limit_per_user}`,
    );
  }
  if (current.usable_qty !== previous.usable_qty) {
    changes.push(`${t('campaigns.fields.usableQty')}: ${previous.usable_qty} → ${current.usable_qty}`);
  }
  if (current.status !== previous.status) {
    changes.push(
      `${t('campaigns.fields.status')}: ${t(`campaigns.status.${previous.status}`)} → ${t(`campaigns.status.${current.status}`)}`,
    );
  }
  if (current.approval_status !== previous.approval_status) {
    changes.push(
      `${t('campaigns.fields.approvalStatus')}: ${t(`campaigns.approvalStatus.${previous.approval_status}`)} → ${t(`campaigns.approvalStatus.${current.approval_status}`)}`,
    );
  }
  if (current.reject_reason !== previous.reject_reason) {
    changes.push(`${t('campaigns.fields.rejectReason')}: ${current.reject_reason ?? '-'}`);
  }
  if (JSON.stringify(current.reward_data) !== JSON.stringify(previous.reward_data)) {
    changes.push(t('campaigns.fields.rewardData'));
  }

  return changes;
}

/** SCR-102 탭 4(변경 이력). 17_CAMPAIGN_API.md 4.2 — 조회 전용, 종료된 캠페인도 계속 조회 가능. */
export function CampaignLogsTab({ campaignId }: { campaignId: number }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<CampaignLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 30 | 50 | 100>(20);
  const [action, setAction] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErrorMessage(null);
    listCampaignLogs(campaignId, { page, page_size: pageSize, action })
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
  }, [campaignId, page, pageSize, action]);

  function handleTableChange(pagination: TablePaginationConfig) {
    setPage(pagination.current ?? 1);
    setPageSize((pagination.pageSize ?? 20) as 20 | 30 | 50 | 100);
  }

  return (
    <div>
      <Select
        placeholder={t('campaigns.logs.actionFilterPlaceholder')}
        style={{ width: 160, marginBottom: 16 }}
        value={action ?? FILTER_ALL}
        onChange={(value) => {
          setAction(value === FILTER_ALL ? undefined : (value as number));
          setPage(1);
        }}
        options={[
          { value: FILTER_ALL, label: t('common.filterAll') },
          ...ACTIONS.map((value) => ({ value, label: t(`campaigns.logs.actions.${value}`) })),
        ]}
      />

      {errorMessage && (
        <div style={{ color: 'red', marginBottom: 16 }}>{errorMessage}</div>
      )}

      <Table<CampaignLog>
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
          { title: t('campaigns.logs.fields.createdAt'), dataIndex: 'created_at' },
          {
            title: t('campaigns.logs.fields.action'),
            dataIndex: 'action',
            render: (value: number) => <Tag>{t(`campaigns.logs.actions.${value}`)}</Tag>,
          },
          {
            title: t('campaigns.logs.fields.createdByName'),
            dataIndex: 'created_by_name',
            render: (value: string | null) => value ?? '-',
          },
          {
            title: t('campaigns.logs.fields.changes'),
            render: (_, record, index) => {
              if (record.action === CREATE_ACTION) {
                return <span>{t('campaigns.logs.createdSnapshot')}</span>;
              }
              // action 필터가 걸려 있으면 배열상 다음 인덱스가 실제 시간순 직전 로그가
              // 아닐 수 있다(중간에 필터로 걸러진 행이 있을 수 있음) — 그 경우 잘못된 비교로
              // 엉뚱한 필드 변경을 표시하느니 비교 자체를 하지 않는다.
              if (action !== undefined) {
                return <span>{t('campaigns.logs.changesUnavailableWhenFiltered')}</span>;
              }
              const previous = items[index + 1];
              if (!previous) {
                return <span>-</span>;
              }
              const changes = diffLogs(record, previous, t);
              if (changes.length === 0) {
                return <span>{t('campaigns.logs.noFieldChange')}</span>;
              }
              return (
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              );
            },
          },
        ]}
      />
    </div>
  );
}
