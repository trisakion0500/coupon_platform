import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import {
  approveCampaign,
  changeCampaignStatus,
  rejectCampaign,
  updateCampaign,
} from '@/api/campaign';
import { getErrorMessage, getResultCode } from '@/api/errors';
import { ApprovalStatusTag } from '@/components/common/ApprovalStatusTag';
import { CampaignStatusTag } from '@/components/common/CampaignStatusTag';
import { GenerationStatusTag } from '@/components/common/GenerationStatusTag';
import { isCampaignExpired } from '@/lib/campaignPeriod';
import { RoleCode } from '@/types/role';
import {
  ApprovalStatus,
  CampaignStatus,
  CodeType,
  type Campaign,
} from '@/types/campaign';

const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

interface EditForm {
  name: string;
  period: [Dayjs, Dayjs];
  use_limit_per_user: number;
  usable_qty: number;
  reward_data: string;
}

interface RejectForm {
  reject_reason: string;
}

/** SCR-102 탭 1(캠페인 정보). 17_CAMPAIGN_API.md 2.4~2.7. */
export function CampaignInfoTab({
  campaign,
  projectRoleCode,
  onReload,
  onCampaignChange,
}: {
  campaign: Campaign;
  projectRoleCode: RoleCode | null;
  onReload: () => void;
  onCampaignChange: (campaign: Campaign) => void;
}) {
  const { t } = useTranslation();
  const [form] = Form.useForm<EditForm>();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusActionLoading, setStatusActionLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectForm] = Form.useForm<RejectForm>();

  const canApproveReject =
    projectRoleCode !== null &&
    projectRoleCode <= RoleCode.MANAGER &&
    campaign.approval_status === ApprovalStatus.PENDING;

  const hasApprovalPrivilege =
    projectRoleCode !== null && projectRoleCode <= RoleCode.MANAGER;

  function startEdit() {
    form.setFieldsValue({
      name: campaign.name,
      period: [dayjs(campaign.campaign_start), dayjs(campaign.campaign_end)],
      use_limit_per_user: campaign.use_limit_per_user,
      usable_qty: campaign.usable_qty,
      reward_data: JSON.stringify(campaign.reward_data, null, 2),
    });
    setErrorMessage(null);
    setEditing(true);
  }

  async function submitUpdate(values: EditForm) {
    let rewardData: Record<string, unknown>;
    try {
      rewardData = JSON.parse(values.reward_data) as Record<string, unknown>;
    } catch {
      form.setFields([
        { name: 'reward_data', errors: [t('campaigns.fields.rewardDataInvalidJson')] },
      ]);
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    try {
      const updated = await updateCampaign(campaign.coupon_campaign_id, {
        edit_count: campaign.edit_count,
        name: values.name,
        campaign_start: values.period[0].format(DATETIME_FORMAT),
        campaign_end: values.period[1].format(DATETIME_FORMAT),
        use_limit_per_user: values.use_limit_per_user,
        usable_qty: values.usable_qty,
        reward_data: rewardData,
      });
      onCampaignChange(updated);
      setEditing(false);
      message.success(t('campaigns.detail.saveSuccess'));
    } catch (error) {
      const resultCode = getResultCode(error);
      if (resultCode === 30005) {
        setErrorMessage(t('campaigns.errors.30005'));
        onReload();
      } else {
        setErrorMessage(getErrorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  }

  function handleEditSubmit(values: EditForm) {
    const wouldPauseActiveCampaign =
      projectRoleCode === RoleCode.OPERATOR &&
      campaign.status === CampaignStatus.ACTIVE &&
      (campaign.approval_status === ApprovalStatus.APPROVED ||
        campaign.approval_status === ApprovalStatus.REJECTED);

    if (wouldPauseActiveCampaign) {
      Modal.confirm({
        title: t('campaigns.detail.operatorReapproveConfirmTitle'),
        content: t('campaigns.detail.operatorReapproveConfirmContent'),
        okText: t('campaigns.detail.save'),
        onOk: () => submitUpdate(values),
      });
      return;
    }

    void submitUpdate(values);
  }

  async function handleStatusChange(status: number) {
    setStatusActionLoading(true);
    setErrorMessage(null);
    try {
      const updated = await changeCampaignStatus(campaign.coupon_campaign_id, {
        edit_count: campaign.edit_count,
        status,
      });
      onCampaignChange(updated);
      message.success(t('campaigns.detail.statusChangeSuccess'));
    } catch (error) {
      const resultCode = getResultCode(error);
      if (resultCode === 30005) {
        setErrorMessage(t('campaigns.errors.30005'));
        onReload();
      } else {
        setErrorMessage(getErrorMessage(error));
      }
    } finally {
      setStatusActionLoading(false);
    }
  }

  async function handleApprove() {
    setApproving(true);
    setErrorMessage(null);
    try {
      const updated = await approveCampaign(campaign.coupon_campaign_id, {
        edit_count: campaign.edit_count,
      });
      onCampaignChange(updated);
      message.success(t('campaigns.detail.approveSuccess'));
    } catch (error) {
      const resultCode = getResultCode(error);
      if (resultCode === 30005) {
        setErrorMessage(t('campaigns.errors.30005'));
        onReload();
      } else {
        setErrorMessage(getErrorMessage(error));
      }
    } finally {
      setApproving(false);
    }
  }

  async function handleRejectSubmit(values: RejectForm) {
    setRejecting(true);
    try {
      const updated = await rejectCampaign(campaign.coupon_campaign_id, {
        edit_count: campaign.edit_count,
        reject_reason: values.reject_reason,
      });
      onCampaignChange(updated);
      message.success(t('campaigns.detail.rejectSuccess'));
      setRejectOpen(false);
      rejectForm.resetFields();
    } catch (error) {
      const resultCode = getResultCode(error);
      if (resultCode === 30005) {
        message.error(t('campaigns.errors.30005'));
        setRejectOpen(false);
        onReload();
      } else {
        message.error(getErrorMessage(error));
      }
    } finally {
      setRejecting(false);
    }
  }

  /**
   * 17_CAMPAIGN_API.md 2.5 — 활성화(1→2)/재활성화(3→2)는 `campaign_end > NOW()`가 SP 조건부
   * UPDATE에도 걸려있다(2026-07-25 추가). 여기서도 같은 조건으로 버튼을 미리 비활성화하고
   * 기간 표시를 빨간색으로 구분해, 클릭 후 30004를 받고서야 이유를 알게 되는 대신 바로
   * 안내한다(`isCampaignExpired`는 `getServerNow()` 기준이라 관리자 기기 시계가 어긋나 있어도
   * 실제 서버 판정과 일치한다).
   */
  const campaignExpired = isCampaignExpired(campaign.campaign_end);

  const statusActions: { label: string; target: number; danger?: boolean; disabled?: boolean }[] = [];
  if (campaign.status === CampaignStatus.PENDING) {
    statusActions.push({
      label: t('campaigns.detail.activate'),
      target: CampaignStatus.ACTIVE,
      disabled: campaignExpired,
    });
    statusActions.push({ label: t('campaigns.detail.cancel'), target: CampaignStatus.ENDED, danger: true });
  } else if (campaign.status === CampaignStatus.ACTIVE) {
    statusActions.push({ label: t('campaigns.detail.pause'), target: CampaignStatus.PAUSED });
    statusActions.push({ label: t('campaigns.detail.end'), target: CampaignStatus.ENDED, danger: true });
  } else if (campaign.status === CampaignStatus.PAUSED) {
    statusActions.push({
      label: t('campaigns.detail.reactivate'),
      target: CampaignStatus.ACTIVE,
      disabled: campaignExpired,
    });
    statusActions.push({ label: t('campaigns.detail.end'), target: CampaignStatus.ENDED, danger: true });
  }

  return (
    <div>
      {errorMessage && (
        <Alert type="error" message={errorMessage} style={{ marginBottom: 16 }} showIcon />
      )}

      <Card style={{ maxWidth: 720, marginBottom: 16 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label={t('campaigns.fields.codeType')}>
            {t(`campaigns.codeType.${campaign.code_type}`)}
          </Descriptions.Item>
          {campaign.code_type === CodeType.RANDOM && (
            <Descriptions.Item label={t('campaigns.fields.useHyphen')}>
              {campaign.use_hyphen === 1 ? t('common.status.active') : t('common.status.inactive')}
            </Descriptions.Item>
          )}
          <Descriptions.Item label={t('campaigns.fields.status')}>
            <CampaignStatusTag status={campaign.status} />
          </Descriptions.Item>
          <Descriptions.Item label={t('campaigns.fields.approvalStatus')}>
            <ApprovalStatusTag approvalStatus={campaign.approval_status} />
          </Descriptions.Item>
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
          {campaign.reject_reason && (
            <Descriptions.Item label={t('campaigns.fields.rejectReason')} span={2}>
              {campaign.reject_reason}
            </Descriptions.Item>
          )}
          <Descriptions.Item label={t('campaigns.fields.createdAt')}>
            {campaign.created_at}
          </Descriptions.Item>
          <Descriptions.Item label={t('campaigns.fields.updatedAt')}>
            {campaign.updated_at}
          </Descriptions.Item>
        </Descriptions>

        <Space wrap style={{ marginTop: 16 }}>
          {statusActions.map((action) =>
            action.disabled ? (
              <Tooltip key={action.target} title={t('campaigns.detail.activateBlockedByExpiry')}>
                <Button disabled>{action.label}</Button>
              </Tooltip>
            ) : (
              <Popconfirm
                key={action.target}
                title={t('campaigns.detail.statusChangeConfirm', { action: action.label })}
                onConfirm={() => handleStatusChange(action.target)}
              >
                <Button danger={action.danger} loading={statusActionLoading}>
                  {action.label}
                </Button>
              </Popconfirm>
            ),
          )}
          {canApproveReject && (
            <>
              <Popconfirm
                title={t('campaigns.detail.approveConfirm')}
                onConfirm={handleApprove}
              >
                <Button type="primary" loading={approving}>
                  {t('campaigns.detail.approve')}
                </Button>
              </Popconfirm>
              <Button danger onClick={() => setRejectOpen(true)}>
                {t('campaigns.detail.reject')}
              </Button>
            </>
          )}
        </Space>
        {!canApproveReject && campaign.approval_status === ApprovalStatus.PENDING && !hasApprovalPrivilege && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 16 }}
            message={t('campaigns.detail.approvalPendingNotice')}
          />
        )}
      </Card>

      <Card
        title={t('campaigns.detail.editTitle')}
        extra={
          !editing &&
          campaign.status !== CampaignStatus.ENDED && (
            <Button size="small" onClick={startEdit}>
              {t('campaigns.detail.edit')}
            </Button>
          )
        }
        style={{ maxWidth: 720 }}
      >
        {editing ? (
          <Form<EditForm> form={form} layout="vertical" onFinish={handleEditSubmit}>
            <Form.Item
              name="name"
              label={t('campaigns.fields.name')}
              rules={[{ required: true, max: 100 }]}
            >
              <Input />
            </Form.Item>
            <Form.Item
              name="period"
              label={t('campaigns.fields.period')}
              rules={[{ required: true }]}
            >
              <DatePicker.RangePicker showTime format={DATETIME_FORMAT} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="use_limit_per_user"
              label={t('campaigns.fields.useLimitPerUser')}
              rules={[{ required: true }]}
            >
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="usable_qty"
              label={t('campaigns.fields.usableQty')}
              rules={[{ required: true }]}
              extra={t('campaigns.fields.usableQtyHint')}
            >
              <InputNumber min={0} max={campaign.generated_qty} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="reward_data"
              label={t('campaigns.fields.rewardData')}
              rules={[{ required: true }]}
            >
              <Input.TextArea rows={4} style={{ fontFamily: 'monospace' }} />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={saving}>
                {t('campaigns.detail.save')}
              </Button>
              <Button onClick={() => setEditing(false)}>{t('campaigns.detail.cancelEdit')}</Button>
            </Space>
          </Form>
        ) : (
          <Descriptions column={1} size="small">
            <Descriptions.Item label={t('campaigns.fields.name')}>{campaign.name}</Descriptions.Item>
            <Descriptions.Item label={t('campaigns.fields.period')}>
              {campaign.campaign_start} ~{' '}
              {campaignExpired ? (
                <Typography.Text type="danger">{campaign.campaign_end}</Typography.Text>
              ) : (
                campaign.campaign_end
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t('campaigns.fields.useLimitPerUser')}>
              {campaign.use_limit_per_user}
            </Descriptions.Item>
            <Descriptions.Item label={t('campaigns.fields.usableQty')}>
              {campaign.usable_qty}
            </Descriptions.Item>
            <Descriptions.Item label={t('campaigns.fields.usedQty')}>
              {campaign.used_qty}
            </Descriptions.Item>
            <Descriptions.Item label={t('campaigns.fields.rewardData')}>
              <pre style={{ margin: 0, fontSize: 12 }}>
                {JSON.stringify(campaign.reward_data, null, 2)}
              </pre>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Card>

      <Modal
        open={rejectOpen}
        title={t('campaigns.detail.rejectModalTitle')}
        onCancel={() => setRejectOpen(false)}
        onOk={() => rejectForm.submit()}
        confirmLoading={rejecting}
      >
        <Form<RejectForm> form={rejectForm} layout="vertical" onFinish={handleRejectSubmit}>
          <Form.Item
            name="reject_reason"
            label={t('campaigns.fields.rejectReason')}
            rules={[{ required: true, max: 500 }]}
          >
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
