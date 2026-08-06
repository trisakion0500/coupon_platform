import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { RateLimitScope } from '@/types/rate-limit-log';

const COLORS: Record<RateLimitScope, string> = {
  10: 'volcano',
  20: 'geekblue',
};

/** log_coupon_rate_limit.limit_scope(10:PROJECT/20:USER) 전용 태그. */
export function RateLimitScopeTag({ scope }: { scope: RateLimitScope }) {
  const { t } = useTranslation();
  return <Tag color={COLORS[scope]}>{t(`admin.rateLimitLogs.scopes.${scope}`)}</Tag>;
}
