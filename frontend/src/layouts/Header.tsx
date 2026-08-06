import { useMemo } from 'react';
import { Layout, Select, Button, Dropdown, Space, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { ClockCircleOutlined, UserOutlined, DownOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useGlobalStore } from '@/stores/globalStore';
import { RoleCode } from '@/types/role';
import { useProjectRoleSync } from '@/hooks/useProjectRoleSync';
import { useServerClock } from '@/hooks/useServerClock';
import { logout } from '@/api/auth';
import { LanguageSwitcher } from '@/components/common/LanguageSwitcher';

const ALL_COMPANIES = '__all_companies__';
const ALL_PROJECTS = '__all_projects__';

/** 18_LAYOUT.md 2.1 — 등록/상세(수정) 관리 화면에서는 헤더 선택을 비활성화한다. */
const ADMIN_LIST_ROUTES = [
  '/admin/companies',
  '/admin/projects',
  '/admin/users',
  '/admin/audit-logs',
  '/admin/rate-limit-logs',
];

/** 18_LAYOUT.md 2장 공통 Header — 로고/회사·프로젝트 선택/[관리] 버튼/사용자 메뉴/언어 선택. */
export function Header() {
  const { t } = useTranslation();
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
  const serverNow = useServerClock();

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
      return [
        { value: ALL_PROJECTS, label: t('header.allProjects') },
        ...options,
      ];
    }
    return options;
  }, [projectList, selectedCompanyId, isSuperAdmin, t]);

  const userMenuItems: MenuProps['items'] = [
    { key: 'my-account', label: t('myAccount.title') },
    { key: 'logout', label: t('myAccount.logout') },
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
            { value: ALL_COMPANIES, label: t('header.allCompanies') },
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
        placeholder={t('header.projectPlaceholder')}
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

      <Tooltip title={t('header.serverTimeTooltip')}>
        <Space size={4} style={{ color: 'rgba(0, 0, 0, 0.45)', whiteSpace: 'nowrap' }}>
          <ClockCircleOutlined />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {dayjs(serverNow).format('YYYY-MM-DD HH:mm:ss')}
          </span>
        </Space>
      </Tooltip>

      {canOpenAdmin && (
        <Button type="text" onClick={() => navigate('/admin')}>
          {t('header.manage')}
        </Button>
      )}

      <LanguageSwitcher />

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
