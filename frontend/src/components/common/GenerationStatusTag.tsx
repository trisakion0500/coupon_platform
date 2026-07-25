import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';

const COLORS: Record<number, string> = {
  1: 'default',
  2: 'blue',
  3: 'green',
  4: 'red',
};

/** coupon_campaign.generation_status(1:대기/2:진행중/3:완료/4:실패) 전용 태그. */
export function GenerationStatusTag({ generationStatus }: { generationStatus: number }) {
  const { t } = useTranslation();
  return (
    <Tag color={COLORS[generationStatus] ?? 'default'}>
      {t(`campaigns.generationStatus.${generationStatus}`, { defaultValue: `#${generationStatus}` })}
    </Tag>
  );
}
