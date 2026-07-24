import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';

const COLORS: Record<number, string> = {
  0: 'gold',
  1: 'green',
  2: 'red',
  3: 'default',
};

const LABEL_KEYS: Record<number, string> = {
  0: 'admin.users.status.pending',
  1: 'admin.users.status.active',
  2: 'admin.users.status.rejected',
  3: 'admin.users.status.suspended',
};

/** user.status(0:승인대기/1:정상/2:반려/3:사용중지) 전용 — company/project의 이치 상태(ActiveStatusTag)와 별도. */
export function UserStatusTag({ status }: { status: number }) {
  const { t } = useTranslation();
  return (
    <Tag color={COLORS[status] ?? 'default'}>
      {t(LABEL_KEYS[status] ?? 'admin.users.status.unknown')}
    </Tag>
  );
}
