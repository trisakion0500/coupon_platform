import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import type { TablePaginationConfig } from 'antd';
import { useTranslation } from 'react-i18next';
import { abortCodeGeneration, issueCodes, listCodes, retryCodeIssuance } from '@/api/campaign';
import { getErrorMessage } from '@/api/errors';
import { CodeStatusTag } from '@/components/common/CodeStatusTag';
import { GenerationStatusTag } from '@/components/common/GenerationStatusTag';
import { RoleCode } from '@/types/role';
import {
  CampaignStatus,
  CodeType,
  GenerationStatus,
  type Campaign,
  type CouponCode,
} from '@/types/campaign';

const FILTER_ALL = 'ALL';

/**
 * SCR-102 탭 2(코드 목록). 17_CAMPAIGN_API.md 3장 — RANDOM은 백그라운드 대량생성 진행상황을
 * 보여주고 발급/재시도/중단 버튼을, FIXED는 단건 등록 폼(미발급 시) 또는 등록된 코드를 보여준다.
 */
export function CampaignCodesTab({
  campaign,
  projectRoleCode,
  onReload,
}: {
  campaign: Campaign;
  projectRoleCode: RoleCode | null;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<CouponCode[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<20 | 30 | 50 | 100>(20);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [issuing, setIssuing] = useState(false);
  const [aborting, setAborting] = useState(false);
  const [fixedForm] = Form.useForm<{ code_value: string }>();

  function loadCodes() {
    setLoading(true);
    setErrorMessage(null);
    listCodes(campaign.coupon_campaign_id, { page, page_size: pageSize, status })
      .then((result) => {
        setItems(result.items);
        setTotalCount(result.total_count);
      })
      .catch((error: unknown) => setErrorMessage(getErrorMessage(error)))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(loadCodes, [campaign.coupon_campaign_id, campaign.generation_status, page, pageSize, status]);

  /** RANDOM 백그라운드 생성 진행 중에는 3초 간격으로 부모에게 캠페인 재조회를 요청해 진행률을 반영한다. */
  useEffect(() => {
    if (
      campaign.code_type !== CodeType.RANDOM ||
      campaign.generation_status !== GenerationStatus.IN_PROGRESS
    ) {
      return;
    }
    const timer = setInterval(onReload, 3000);
    return () => clearInterval(timer);
  }, [campaign.code_type, campaign.generation_status, onReload]);

  function handleTableChange(pagination: TablePaginationConfig) {
    setPage(pagination.current ?? 1);
    setPageSize((pagination.pageSize ?? 20) as 20 | 30 | 50 | 100);
  }

  async function handleIssueRandom() {
    setIssuing(true);
    setErrorMessage(null);
    try {
      await issueCodes(campaign.coupon_campaign_id);
      message.success(t('campaigns.codes.issueStarted'));
      onReload();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIssuing(false);
    }
  }

  async function handleIssueFixed(values: { code_value: string }) {
    setIssuing(true);
    setErrorMessage(null);
    try {
      await issueCodes(campaign.coupon_campaign_id, { code_value: values.code_value });
      message.success(t('campaigns.codes.issueSuccess'));
      onReload();
      loadCodes();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIssuing(false);
    }
  }

  async function handleRetry() {
    setIssuing(true);
    setErrorMessage(null);
    try {
      await retryCodeIssuance(campaign.coupon_campaign_id);
      message.success(t('campaigns.codes.retryStarted'));
      onReload();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIssuing(false);
    }
  }

  async function handleAbort() {
    setAborting(true);
    setErrorMessage(null);
    try {
      await abortCodeGeneration(campaign.coupon_campaign_id);
      message.success(t('campaigns.codes.abortSuccess'));
      onReload();
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setAborting(false);
    }
  }

  const canAbort = projectRoleCode !== null && projectRoleCode <= RoleCode.MANAGER;
  const campaignEnded = campaign.status === CampaignStatus.ENDED;

  return (
    <div>
      {errorMessage && (
        <Alert type="error" message={errorMessage} style={{ marginBottom: 16 }} showIcon />
      )}

      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label={t('campaigns.fields.generationStatus')}>
            <GenerationStatusTag generationStatus={campaign.generation_status} />
          </Descriptions.Item>
          <Descriptions.Item label={t('campaigns.fields.qty')}>
            {campaign.generated_qty}/{campaign.requested_qty}
          </Descriptions.Item>
          {campaign.generation_error && (
            <Descriptions.Item label={t('campaigns.fields.generationError')} span={2}>
              <Typography.Text type="danger">{campaign.generation_error}</Typography.Text>
            </Descriptions.Item>
          )}
        </Descriptions>

        {campaign.code_type === CodeType.RANDOM ? (
          <Space wrap>
            {campaign.generation_status === GenerationStatus.WAITING && !campaignEnded && (
              <Button type="primary" loading={issuing} onClick={handleIssueRandom}>
                {t('campaigns.codes.issue')}
              </Button>
            )}
            {campaign.generation_status === GenerationStatus.FAILED && !campaignEnded && (
              <Button type="primary" loading={issuing} onClick={handleRetry}>
                {t('campaigns.codes.retry')}
              </Button>
            )}
            {campaign.generation_status === GenerationStatus.IN_PROGRESS &&
              canAbort &&
              !campaignEnded && (
                <Popconfirm title={t('campaigns.codes.abortConfirm')} onConfirm={handleAbort}>
                  <Button danger loading={aborting}>
                    {t('campaigns.codes.abort')}
                  </Button>
                </Popconfirm>
              )}
          </Space>
        ) : (
          campaign.generation_status === GenerationStatus.WAITING &&
          !campaignEnded && (
            <Form<{ code_value: string }>
              form={fixedForm}
              layout="inline"
              onFinish={handleIssueFixed}
            >
              <Form.Item name="code_value" rules={[{ required: true, max: 50 }]}>
                <Input
                  placeholder={t('campaigns.codes.codeValuePlaceholder')}
                  style={{ width: 240 }}
                />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" loading={issuing}>
                  {t('campaigns.codes.registerFixed')}
                </Button>
              </Form.Item>
            </Form>
          )
        )}
      </Card>

      <Select
        placeholder={t('campaigns.codes.statusFilterPlaceholder')}
        style={{ width: 160, marginBottom: 16 }}
        value={status ?? FILTER_ALL}
        onChange={(value) => {
          setStatus(value === FILTER_ALL ? undefined : (value as number));
          setPage(1);
        }}
        options={[
          { value: FILTER_ALL, label: t('common.filterAll') },
          { value: 0, label: t('campaigns.codeStatus.0') },
          {
            value: 1,
            label: t(
              campaign.code_type === CodeType.FIXED
                ? 'campaigns.codeStatus.1_fixed'
                : 'campaigns.codeStatus.1',
            ),
          },
          { value: 2, label: t('campaigns.codeStatus.2') },
        ]}
      />

      <Table<CouponCode>
        rowKey="coupon_code_id"
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
          { title: t('campaigns.codes.fields.codeValue'), dataIndex: 'code_value' },
          {
            title: t('campaigns.codes.fields.status'),
            dataIndex: 'status',
            render: (value: number) => (
              <CodeStatusTag status={value} codeType={campaign.code_type} />
            ),
          },
          { title: t('campaigns.codes.fields.createdAt'), dataIndex: 'created_at' },
        ]}
      />
    </div>
  );
}
