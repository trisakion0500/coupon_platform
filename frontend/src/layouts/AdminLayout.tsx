import { useMemo } from 'react';
import { Layout, Menu } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Header } from '@/layouts/Header';
import { Footer } from '@/layouts/Footer';
import { useAuthStore } from '@/stores/authStore';
import { RoleCode } from '@/types/role';

/** 16_LAYOUT.md 4.1 — 관리 메뉴 사이드바, role별 노출 항목이 다르다. */
const ALL_MENU_ITEMS: { key: string; label: string; allow: RoleCode[] }[] = [
  { key: '/admin/companies', label: '회사', allow: [RoleCode.SUPER_ADMIN] },
  {
    key: '/admin/projects',
    label: '프로젝트',
    allow: [RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER],
  },
  {
    key: '/admin/users',
    label: '사용자',
    allow: [RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER],
  },
  {
    key: '/admin/audit-logs',
    label: '감사로그',
    allow: [RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER],
  },
];

/** 16_LAYOUT.md 4장 — 관리 업무 레이아웃. MANAGER/OPERATOR는 라우트 자체가 RoleGuard로 차단된다. */
export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const roleCode = useAuthStore((state) => state.roleCode);

  const menuItems = useMemo(
    () =>
      ALL_MENU_ITEMS.filter(
        (item) => roleCode !== null && item.allow.includes(roleCode),
      ).map(({ key, label }) => ({ key, label })),
    [roleCode],
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
