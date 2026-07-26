import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { CouponUseResultType } from '@/types/coupon-use-log';

const COLORS: Record<CouponUseResultType, string> = {
  0: 'green',
  10: 'default',
  20: 'gold',
  30: 'red',
  40: 'red',
  50: 'default',
};

/** log_coupon_use.result_type(0:성공/10:코드없음/20:이미소모·중지/30:캠페인 사용불가/
 * 40:사용자한도초과/50:소모기록없음) 전용 태그. */
export function CouponUseResultTag({ resultType }: { resultType: CouponUseResultType }) {
  const { t } = useTranslation();
  return (
    <Tag color={COLORS[resultType]}>{t(`couponUseLogs.resultTypes.${resultType}`)}</Tag>
  );
}
