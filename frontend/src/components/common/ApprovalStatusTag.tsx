import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';

const COLORS: Record<number, string> = {
  1: 'default',
  2: 'gold',
  3: 'green',
  4: 'red',
};

/** coupon_campaign.approval_status(1:승인불요/2:승인대기/3:승인완료/4:반려) 전용 태그. */
export function ApprovalStatusTag({ approvalStatus }: { approvalStatus: number }) {
  const { t } = useTranslation();
  return (
    <Tag color={COLORS[approvalStatus] ?? 'default'}>
      {t(`campaigns.approvalStatus.${approvalStatus}`, { defaultValue: `#${approvalStatus}` })}
    </Tag>
  );
}
