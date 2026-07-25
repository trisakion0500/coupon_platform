import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';

const COLORS: Record<number, string> = {
  1: 'default',
  2: 'green',
  3: 'orange',
  4: 'default',
};

/** coupon_campaign.status(1:대기/2:활성/3:일시중지/4:종료) 전용 태그. */
export function CampaignStatusTag({ status }: { status: number }) {
  const { t } = useTranslation();
  return (
    <Tag color={COLORS[status] ?? 'default'}>
      {t(`campaigns.status.${status}`, { defaultValue: `#${status}` })}
    </Tag>
  );
}
