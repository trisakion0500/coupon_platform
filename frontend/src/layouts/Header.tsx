import { useMemo } from 'react';
import { Layout, Select, Button, Dropdown, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { UserOutlined, DownOutlined } from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalStore } from '@/stores/globalStore';
import { RoleCode } from '@/types/role';
import { useProjectRoleSync } from '@/hooks/useProjectRoleSync';
import { logout } from '@/api/auth';

const ALL_COMPANIES = '__all_companies__';
const ALL_PROJECTS = '__all_projects__';

/** 16_LAYOUT.md 2.1 — 등록/상세(수정) 관리 화면에서는 헤더 선택을 비활성화한다. */
const ADMIN_LIST_ROUTES = [
  '/admin/companies',
  '/admin/projects',
  '/admin/users',
  '/admin/audit-logs',
];

/** 16_LAYOUT.md 2장 공통 Header — 로고/회사·프로젝트 선택/[관리] 버튼/사용자 메뉴. */
export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const roleCode = useAuthStore((state) => state.roleCode);
  const user = useAuthStore((state) => state.user);
  const clearAuth = useAuthStore((state) => state.clear);

  const companyList = useGlobalStore((state) => state.companyList);
  const projectList = useGlobalStore((state) => state.projectList);
  const selectedCompanyId = useGlobalStore((state) => state.selectedCompanyId);
  const selectedProjectId = useGlobalStore((state) => state.selectedProjectId);
  const setSelectedCompanyId = useGlobalStore(
    (state) => state.setSelectedCompanyId,
  );
  const setSelectedProjectId = useGlobalStore(
    (state) => state.setSelectedProjectId,
  );

  useProjectRoleSync();

  const isAdminRoute = location.pathname.startsWith('/admin');
  const headerLocked =
    isAdminRoute && !ADMIN_LIST_ROUTES.includes(location.pathname);

  const isSuperAdmin = roleCode === RoleCode.SUPER_ADMIN;
  const canOpenAdmin =
    roleCode === RoleCode.SUPER_ADMIN || roleCode === RoleCode.DEVELOPER;

  const projectOptions = useMemo(() => {
    const filtered =
      selectedCompanyId === null
        ? projectList
        : projectList.filter((p) => p.company_id === selectedCompanyId);
    const options = filtered.map((p) => ({
      value: String(p.project_id),
      label: p.project_name,
    }));
    if (isSuperAdmin) {
      return [{ value: ALL_PROJECTS, label: '전체 프로젝트' }, ...options];
    }
    return options;
  }, [projectList, selectedCompanyId, isSuperAdmin]);

  const userMenuItems: MenuProps['items'] = [
    { key: 'my-account', label: '내 계정' },
    { key: 'logout', label: '로그아웃' },
  ];

  async function handleUserMenuClick({ key }: { key: string }) {
    if (key === 'my-account') {
      navigate('/my-account');
      return;
    }
    if (key === 'logout') {
      try {
        await logout();
      } finally {
        clearAuth();
        navigate('/login', { replace: true });
      }
    }
  }

  return (
    <Layout.Header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        paddingInline: 24,
      }}
    >
      <Typography.Title
        level={5}
        style={{ margin: 0, cursor: 'pointer', whiteSpace: 'nowrap' }}
        onClick={() => navigate('/campaigns')}
      >
        {import.meta.env.VITE_APP_NAME}
      </Typography.Title>

      {isSuperAdmin ? (
        <Select
          disabled={headerLocked}
          style={{ width: 180 }}
          value={
            selectedCompanyId === null ? ALL_COMPANIES : String(selectedCompanyId)
          }
          onChange={(value) =>
            setSelectedCompanyId(value === ALL_COMPANIES ? null : Number(value))
          }
          options={[
            { value: ALL_COMPANIES, label: '전체 회사' },
            ...companyList.map((c) => ({
              value: String(c.company_id),
              label: c.company_name,
            })),
          ]}
        />
      ) : (
        <Select
          disabled
          style={{ width: 180 }}
          value={companyList[0]?.company_name}
          options={
            companyList[0]
              ? [{ value: companyList[0].company_name, label: companyList[0].company_name }]
              : []
          }
        />
      )}

      <Select
        disabled={headerLocked}
        style={{ width: 200 }}
        placeholder="프로젝트 선택"
        value={
          selectedProjectId === null
            ? isSuperAdmin
              ? ALL_PROJECTS
              : undefined
            : String(selectedProjectId)
        }
        onChange={(value) =>
          setSelectedProjectId(value === ALL_PROJECTS ? null : Number(value))
        }
        options={projectOptions}
      />

      <div style={{ flex: 1 }} />

      {canOpenAdmin && (
        <Button type="text" onClick={() => navigate('/admin')}>
          관리
        </Button>
      )}

      <Dropdown
        menu={{ items: userMenuItems, onClick: handleUserMenuClick }}
        trigger={['click']}
      >
        <Space style={{ cursor: 'pointer' }}>
          <UserOutlined />
          {user?.user_name ?? ''}
          <DownOutlined style={{ fontSize: 10 }} />
        </Space>
      </Dropdown>
    </Layout.Header>
  );
}
