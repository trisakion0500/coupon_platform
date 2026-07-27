import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Switch,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { createCampaign } from '@/api/campaign';
import { getErrorMessage } from '@/api/errors';
import { PageHeader } from '@/components/common/PageHeader';
import { RequireProjectSelected } from '@/components/guards/RequireProjectSelected';
import { useGlobalStore } from '@/stores/globalStore';
import { CodeType } from '@/types/campaign';

const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

interface CampaignForm {
  name: string;
  period: [Dayjs, Dayjs];
  code_type: number;
  use_hyphen: boolean;
  requested_qty: number;
  use_limit_per_user: number;
  reward_data: string;
}

/** SCR-101. 19_CAMPAIGN_API.md 2.1. */
export function CampaignNewPage() {
  return (
    <RequireProjectSelected>
      <CampaignNewContent />
    </RequireProjectSelected>
  );
}

function CampaignNewContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const selectedProjectId = useGlobalStore((state) => state.selectedProjectId)!;
  const [form] = Form.useForm<CampaignForm>();
  const codeType = Form.useWatch('code_type', form) ?? CodeType.RANDOM;
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(values: CampaignForm) {
    setErrorMessage(null);

    let rewardData: Record<string, unknown>;
    try {
      rewardData = JSON.parse(values.reward_data) as Record<string, unknown>;
    } catch {
      form.setFields([
        { name: 'reward_data', errors: [t('campaigns.fields.rewardDataInvalidJson')] },
      ]);
      return;
    }

    setSubmitting(true);
    try {
      const campaign = await createCampaign({
        project_id: selectedProjectId,
        name: values.name,
        campaign_start: values.period[0].format(DATETIME_FORMAT),
        campaign_end: values.period[1].format(DATETIME_FORMAT),
        code_type: values.code_type,
        use_hyphen: values.code_type === CodeType.RANDOM ? (values.use_hyphen ? 1 : 0) : undefined,
        requested_qty: values.requested_qty,
        use_limit_per_user: values.use_limit_per_user,
        reward_data: rewardData,
      });
      navigate(`/campaigns/${campaign.coupon_campaign_id}`, {
        replace: true,
        state: { justCreated: true },
      });
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={t('campaigns.new.title')}
        actions={
          <Button onClick={() => navigate('/campaigns')}>
            {t('campaigns.backToList')}
          </Button>
        }
      />
      <Card style={{ maxWidth: 640 }}>
        {errorMessage && (
          <Alert
            type="error"
            message={errorMessage}
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}
        <Form<CampaignForm>
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{
            code_type: CodeType.RANDOM,
            use_hyphen: true,
            use_limit_per_user: 1,
            reward_data: '{}',
            period: [dayjs(), dayjs().add(1, 'month')],
          }}
        >
          <Form.Item
            name="name"
            label={t('campaigns.fields.name')}
            rules={[{ required: true, message: t('campaigns.fields.nameRequired') }, { max: 100 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="period"
            label={t('campaigns.fields.period')}
            rules={[{ required: true, message: t('campaigns.fields.periodRequired') }]}
          >
            <DatePicker.RangePicker showTime format={DATETIME_FORMAT} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="code_type"
            label={t('campaigns.fields.codeType')}
            rules={[{ required: true }]}
          >
            <Radio.Group
              options={[
                { value: CodeType.RANDOM, label: t('campaigns.codeType.1') },
                { value: CodeType.FIXED, label: t('campaigns.codeType.2') },
              ]}
            />
          </Form.Item>
          {codeType === CodeType.RANDOM && (
            <Form.Item
              name="use_hyphen"
              label={t('campaigns.fields.useHyphen')}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          )}
          <Form.Item
            name="requested_qty"
            label={
              codeType === CodeType.FIXED
                ? t('campaigns.fields.requestedQtyFixed')
                : t('campaigns.fields.requestedQtyRandom')
            }
            rules={[{ required: true, message: t('campaigns.fields.requestedQtyRequired') }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="use_limit_per_user"
            label={t('campaigns.fields.useLimitPerUser')}
            rules={[{ required: true }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="reward_data"
            label={t('campaigns.fields.rewardData')}
            rules={[{ required: true, message: t('campaigns.fields.rewardDataRequired') }]}
            extra={t('campaigns.fields.rewardDataHint')}
          >
            <Input.TextArea rows={4} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={submitting}>
              {t('campaigns.new.submit')}
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
