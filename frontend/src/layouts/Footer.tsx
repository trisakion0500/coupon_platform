import { Layout } from 'antd';
import { useTranslation } from 'react-i18next';

/** 18_LAYOUT.md 6장 — MainLayout/AdminLayout/AuthLayout 공통 하단. */
export function Footer() {
  const { t } = useTranslation();
  return (
    <Layout.Footer style={{ textAlign: 'center', color: 'rgba(0,0,0,0.45)' }}>
      {import.meta.env.VITE_FOOTER_COPYRIGHT} | {import.meta.env.VITE_APP_VERSION} |{' '}
      {t('footer.inquiry')}: {import.meta.env.VITE_SUPPORT_EMAIL}
    </Layout.Footer>
  );
}
