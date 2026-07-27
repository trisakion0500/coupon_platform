import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthLayout } from '@/layouts/AuthLayout';
import { MainLayout } from '@/layouts/MainLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { RequireAuth } from '@/components/guards/RequireAuth';
import { RequireGuest } from '@/components/guards/RequireGuest';
import { RoleGuard } from '@/components/guards/RoleGuard';
import { RoleCode } from '@/types/role';
import { LoginPage } from '@/pages/auth/LoginPage';
import { SignupPage } from '@/pages/auth/SignupPage';
import { CampaignListPage } from '@/pages/campaigns/CampaignListPage';
import { CampaignNewPage } from '@/pages/campaigns/CampaignNewPage';
import { CampaignDetailPage } from '@/pages/campaigns/CampaignDetailPage';
import { CouponUseLogsPage } from '@/pages/coupon-use-logs/CouponUseLogsPage';
import { MyAccountPage } from '@/pages/my-account/MyAccountPage';
import { AdminIndexRedirect } from '@/routes/AdminIndexRedirect';
import { CompanyListPage } from '@/pages/admin/companies/CompanyListPage';
import { CompanyNewPage } from '@/pages/admin/companies/CompanyNewPage';
import { CompanyDetailPage } from '@/pages/admin/companies/CompanyDetailPage';
import { ProjectListPage } from '@/pages/admin/projects/ProjectListPage';
import { ProjectNewPage } from '@/pages/admin/projects/ProjectNewPage';
import { ProjectDetailPage } from '@/pages/admin/projects/ProjectDetailPage';
import { UserListPage } from '@/pages/admin/users/UserListPage';
import { UserDetailPage } from '@/pages/admin/users/UserDetailPage';
import { AuditLogListPage } from '@/pages/admin/audit-logs/AuditLogListPage';
import { AuditLogDetailPage } from '@/pages/admin/audit-logs/AuditLogDetailPage';
import { ForbiddenPage } from '@/pages/errors/ForbiddenPage';
import { NotFoundPage } from '@/pages/errors/NotFoundPage';

const SUPER_ADMIN_ONLY = [RoleCode.SUPER_ADMIN];
const SUPER_ADMIN_AND_DEVELOPER = [RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER];

/** 18_LAYOUT.md 7장 Route 구조를 그대로 옮긴 라우트 트리. */
export function AppRoutes() {
  return (
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
  );
}
