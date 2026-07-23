import { Result, Button } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export function NotFoundPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Result
      status="404"
      title="404"
      subTitle={t('errors.notFound.subtitle')}
      extra={
        <Button type="primary" onClick={() => navigate('/campaigns')}>
          {t('errors.notFound.home')}
        </Button>
      }
    />
  );
}
