import { Result, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/** 16_LAYOUT.md 8장 — role 가드 미충족 시 이동하는 403 페이지. */
export function ForbiddenPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Result
      status="403"
      title="403"
      subTitle={t('errors.forbidden.subtitle')}
      extra={
        <Button type="primary" onClick={() => navigate('/campaigns')}>
          {t('errors.forbidden.home')}
        </Button>
      }
    />
  );
}
