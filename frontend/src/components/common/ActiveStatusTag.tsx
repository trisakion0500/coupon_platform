import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';

/** company/project 공통 status(1=사용/0=중지) 표시 — user/campaign 등 다치 상태값은 별도로 다룬다. */
export function ActiveStatusTag({ status }: { status: number }) {
  const { t } = useTranslation();
  return (
    <Tag color={status === 1 ? 'green' : 'default'}>
      {t(status === 1 ? 'common.status.active' : 'common.status.inactive')}
    </Tag>
  );
}
