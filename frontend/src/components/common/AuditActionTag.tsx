import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import type { AuditAction } from '@/types/audit-log';

const COLORS: Record<AuditAction, string> = {
  10: 'blue',
  20: 'gold',
  30: 'purple',
};

const LABEL_KEYS: Record<AuditAction, string> = {
  10: 'admin.auditLogs.actions.10',
  20: 'admin.auditLogs.actions.20',
  30: 'admin.auditLogs.actions.30',
};

/** log_audit.action(10:CREATE/20:UPDATE/30:STATUS_CHANGE) 전용 태그. */
export function AuditActionTag({ action }: { action: AuditAction }) {
  const { t } = useTranslation();
  return <Tag color={COLORS[action]}>{t(LABEL_KEYS[action])}</Tag>;
}
