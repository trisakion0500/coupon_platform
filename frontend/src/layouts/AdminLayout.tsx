import { useMemo } from 'react';
import { Layout, Menu } from 'antd';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Header } from '@/layouts/Header';
import { Footer } from '@/layouts/Footer';
import { useAuthStore } from '@/stores/authStore';
import { RoleCode } from '@/types/role';

/** 18_LAYOUT.md 4.1 — 관리 메뉴 사이드바, role별 노출 항목이 다르다. */
const ALL_MENU_ITEMS: { key: string; labelKey: string; allow: RoleCode[] }[] = [
  {
    key: '/admin/companies',
    labelKey: 'nav.admin.companies',
    allow: [RoleCode.SUPER_ADMIN],
  },
  {
    key: '/admin/projects',
    labelKey: 'nav.admin.projects',
    allow: [RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER],
  },
  {
    key: '/admin/users',
    labelKey: 'nav.admin.users',
    allow: [RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER],
  },
  {
    key: '/admin/audit-logs',
    labelKey: 'nav.admin.auditLogs',
    allow: [RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER],
  },
  {
    key: '/admin/rate-limit-logs',
    labelKey: 'nav.admin.rateLimitLogs',
    allow: [RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER],
  },
];

/** 18_LAYOUT.md 4장 — 관리 업무 레이아웃. MANAGER/OPERATOR는 라우트 자체가 RoleGuard로 차단된다. */
export function AdminLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const roleCode = useAuthStore((state) => state.roleCode);

  const menuItems = useMemo(
    () =>
      ALL_MENU_ITEMS.filter(
        (item) => roleCode !== null && item.allow.includes(roleCode),
      ).map(({ key, labelKey }) => ({ key, label: t(labelKey) })),
    [roleCode, t],
  );

  const selectedKey =
    menuItems.find((item) => location.pathname.startsWith(item.key))?.key ??
    menuItems[0]?.key;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header />
      <Layout>
        <Layout.Sider width={200} theme="light">
          <Menu
            mode="inline"
            selectedKeys={selectedKey ? [selectedKey] : []}
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
