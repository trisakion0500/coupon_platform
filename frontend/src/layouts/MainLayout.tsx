import { Layout, Menu } from 'antd';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Header } from '@/layouts/Header';
import { Footer } from '@/layouts/Footer';

/** 16_LAYOUT.md 3장 — 기본 레이아웃(Header + Sidebar + Content + Footer). */
export function MainLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  /** 16_LAYOUT.md 3.1 — 비관리 업무(쿠폰 컨트롤) 사이드바. 4개 role 전부 접근 가능. */
  const menuItems = [
    { key: '/campaigns', label: t('nav.campaigns') },
    { key: '/coupon-use-logs', label: t('nav.couponUseLogs') },
  ];

  const selectedKey =
    menuItems.find((item) => location.pathname.startsWith(item.key))?.key ??
    '/campaigns';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header />
      <Layout>
        <Layout.Sider width={200} theme="light">
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ height: '100%', borderInlineEnd: 0 }}
          />
        </Layout.Sider>
        <Layout style={{ padding: 24 }}>
          <Layout.Content>
            <Outlet />
          </Layout.Content>
        </Layout>
      </Layout>
      <Footer />
    </Layout>
  );
}
