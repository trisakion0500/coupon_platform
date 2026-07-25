import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { CodeType } from '@/types/campaign';

const COLORS: Record<number, string> = {
  0: 'default',
  1: 'blue',
  2: 'green',
};

/**
 * coupon_code.status(0:중지, 1:미사용(RANDOM)/사용중(FIXED), 2:사용완료(RANDOM 전용)) 전용
 * 태그 — 같은 값(1)도 code_type에 따라 의미가 다르므로 codeType을 함께 받는다.
 */
export function CodeStatusTag({ status, codeType }: { status: number; codeType: number }) {
  const { t } = useTranslation();
  const key = status === 1 && codeType === CodeType.FIXED ? '1_fixed' : String(status);
  return (
    <Tag color={COLORS[status] ?? 'default'}>
      {t(`campaigns.codeStatus.${key}`, { defaultValue: `#${status}` })}
    </Tag>
  );
}
