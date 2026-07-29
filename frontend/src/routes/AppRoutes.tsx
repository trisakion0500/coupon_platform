import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthLayout } from '@/layouts/AuthLayout';
import { MainLayout } from '@/layouts/MainLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { RequireAuth } from '@/components/guards/RequireAuth';
import { RequireGuest } from '@/components/guards/RequireGuest';
import { RoleGuard } from '@/components/guards/RoleGuard';
import { RoleCode } from '@/types/role';
import { RouteLoadingFallback } from '@/components/common/RouteLoadingFallback';
import { AdminIndexRedirect } from '@/routes/AdminIndexRedirect';

const LoginPage = lazy(() =>
  import('@/pages/auth/LoginPage').then((m) => ({ default: m.LoginPage })),
);
const SignupPage = lazy(() =>
  import('@/pages/auth/SignupPage').then((m) => ({ default: m.SignupPage })),
);
const CampaignListPage = lazy(() =>
  import('@/pages/campaigns/CampaignListPage').then((m) => ({
    default: m.CampaignListPage,
  })),
);
const CampaignNewPage = lazy(() =>
  import('@/pages/campaigns/CampaignNewPage').then((m) => ({
    default: m.CampaignNewPage,
  })),
);
const CampaignDetailPage = lazy(() =>
  import('@/pages/campaigns/CampaignDetailPage').then((m) => ({
    default: m.CampaignDetailPage,
  })),
);
const CouponUseLogsPage = lazy(() =>
  import('@/pages/coupon-use-logs/CouponUseLogsPage').then((m) => ({
    default: m.CouponUseLogsPage,
  })),
);
const MyAccountPage = lazy(() =>
  import('@/pages/my-account/MyAccountPage').then((m) => ({
    default: m.MyAccountPage,
  })),
);
const CompanyListPage = lazy(() =>
  import('@/pages/admin/companies/CompanyListPage').then((m) => ({
    default: m.CompanyListPage,
  })),
);
const CompanyNewPage = lazy(() =>
  import('@/pages/admin/companies/CompanyNewPage').then((m) => ({
    default: m.CompanyNewPage,
  })),
);
const CompanyDetailPage = lazy(() =>
  import('@/pages/admin/companies/CompanyDetailPage').then((m) => ({
    default: m.CompanyDetailPage,
  })),
);
const ProjectListPage = lazy(() =>
  import('@/pages/admin/projects/ProjectListPage').then((m) => ({
    default: m.ProjectListPage,
  })),
);
const ProjectNewPage = lazy(() =>
  import('@/pages/admin/projects/ProjectNewPage').then((m) => ({
    default: m.ProjectNewPage,
  })),
);
const ProjectDetailPage = lazy(() =>
  import('@/pages/admin/projects/ProjectDetailPage').then((m) => ({
    default: m.ProjectDetailPage,
  })),
);
const UserListPage = lazy(() =>
  import('@/pages/admin/users/UserListPage').then((m) => ({
    default: m.UserListPage,
  })),
);
const UserDetailPage = lazy(() =>
  import('@/pages/admin/users/UserDetailPage').then((m) => ({
    default: m.UserDetailPage,
  })),
);
const AuditLogListPage = lazy(() =>
  import('@/pages/admin/audit-logs/AuditLogListPage').then((m) => ({
    default: m.AuditLogListPage,
  })),
);
const AuditLogDetailPage = lazy(() =>
  import('@/pages/admin/audit-logs/AuditLogDetailPage').then((m) => ({
    default: m.AuditLogDetailPage,
  })),
);
const ForbiddenPage = lazy(() =>
  import('@/pages/errors/ForbiddenPage').then((m) => ({
    default: m.ForbiddenPage,
  })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/errors/NotFoundPage').then((m) => ({
    default: m.NotFoundPage,
  })),
);

const SUPER_ADMIN_ONLY = [RoleCode.SUPER_ADMIN];
const SUPER_ADMIN_AND_DEVELOPER = [RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER];

/**
 * 18_LAYOUT.md 7장 Route 구조를 그대로 옮긴 라우트 트리.
 * 화면(leaf) 컴포넌트는 전부 React.lazy로 라우트 단위 코드 스플리팅한다
 * (단일 청크 500kB 경고 해소 — vite.config.ts의 vendor 청크 분리와 병행).
 */
export function AppRoutes() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
      <Route
        element={
          <RequireGuest>
            <AuthLayout />
          </RequireGuest>
        }
      >
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/campaigns" replace />} />

      <Route
        element={
          <RequireAuth>
            <MainLayout />
          </RequireAuth>
        }
      >
        <Route path="/campaigns" element={<CampaignListPage />} />
        <Route path="/campaigns/new" element={<CampaignNewPage />} />
        <Route
          path="/campaigns/:coupon_campaign_id"
          element={<CampaignDetailPage />}
        />
        <Route path="/coupon-use-logs" element={<CouponUseLogsPage />} />
        <Route path="/my-account" element={<MyAccountPage />} />
      </Route>

      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<AdminIndexRedirect />} />
        <Route
          path="companies"
          element={
            <RoleGuard allow={SUPER_ADMIN_ONLY}>
              <CompanyListPage />
            </RoleGuard>
          }
        />
        <Route
          path="companies/new"
          element={
            <RoleGuard allow={SUPER_ADMIN_ONLY}>
              <CompanyNewPage />
            </RoleGuard>
          }
        />
        <Route
          path="companies/:company_id"
          element={
            <RoleGuard allow={SUPER_ADMIN_ONLY}>
              <CompanyDetailPage />
            </RoleGuard>
          }
        />
        <Route
          path="projects"
          element={
            <RoleGuard allow={SUPER_ADMIN_AND_DEVELOPER}>
              <ProjectListPage />
            </RoleGuard>
          }
        />
        <Route
          path="projects/new"
          element={
            <RoleGuard allow={SUPER_ADMIN_ONLY}>
              <ProjectNewPage />
            </RoleGuard>
          }
        />
        <Route
          path="projects/:project_id"
          element={
            <RoleGuard allow={SUPER_ADMIN_AND_DEVELOPER}>
              <ProjectDetailPage />
            </RoleGuard>
          }
        />
        <Route
          path="users"
          element={
            <RoleGuard allow={SUPER_ADMIN_AND_DEVELOPER}>
              <UserListPage />
            </RoleGuard>
          }
        />
        <Route
          path="users/:user_id"
          element={
            <RoleGuard allow={SUPER_ADMIN_AND_DEVELOPER}>
              <UserDetailPage />
            </RoleGuard>
          }
        />
        <Route
          path="audit-logs"
          element={
            <RoleGuard allow={SUPER_ADMIN_AND_DEVELOPER}>
              <AuditLogListPage />
            </RoleGuard>
          }
        />
        <Route
          path="audit-logs/:idx"
          element={
            <RoleGuard allow={SUPER_ADMIN_AND_DEVELOPER}>
              <AuditLogDetailPage />
            </RoleGuard>
          }
        />
      </Route>

        <Route path="/403" element={<ForbiddenPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
