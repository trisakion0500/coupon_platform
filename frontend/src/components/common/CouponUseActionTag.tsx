import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { CouponUseAction } from '@/types/coupon-use-log';

const COLORS: Record<CouponUseAction, string> = {
  10: 'blue',
  20: 'green',
};

/** log_coupon_use.action(10:RESERVE/20:CONFIRM) 전용 태그. */
export function CouponUseActionTag({ action }: { action: CouponUseAction }) {
  const { t } = useTranslation();
  return <Tag color={COLORS[action]}>{t(`couponUseLogs.actions.${action}`)}</Tag>;
}
