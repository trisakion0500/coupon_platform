import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CampaignModule } from './campaign/campaign.module';
import { CompanyModule } from './company/company.module';
import { ApiSecretCleanupModule } from './common/api-secret-cleanup/api-secret-cleanup.module';
import { AuditLogModule } from './common/audit-log/audit-log.module';
import { CodeGenerationStaleMonitorModule } from './common/code-generation-stale-monitor/code-generation-stale-monitor.module';
import { envValidationSchema } from './common/config/env.validation';
import { DatabaseModule } from './common/database/database.module';
import { LogDatabaseModule } from './common/database/log-database.module';
import { NonceCleanupModule } from './common/nonce-cleanup/nonce-cleanup.module';
import { SessionCleanupModule } from './common/session-cleanup/session-cleanup.module';
import { CouponUsageModule } from './coupon-usage/coupon-usage.module';
import { CouponUseLogModule } from './coupon-use-log/coupon-use-log.module';
import { HealthModule } from './health/health.module';
import { LogAuditModule } from './log-audit/log-audit.module';
import { ProjectModule } from './project/project.module';
import { UserModule } from './user/user.module';
import { UserRoleModule } from './user-role/user-role.module';

/**
 * 애플리케이션 루트 모듈 — 공통 인프라(환경설정/DB) + 도메인 모듈을 조립한다.
 *
 * @author trisakion
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    DatabaseModule,
    LogDatabaseModule,
    AuditLogModule,
    SessionCleanupModule,
    ApiSecretCleanupModule,
    NonceCleanupModule,
    CodeGenerationStaleMonitorModule,
    HealthModule,
    AuthModule,
    CompanyModule,
    ProjectModule,
    UserModule,
    UserRoleModule,
    CampaignModule,
    CouponUsageModule,
    CouponUseLogModule,
    LogAuditModule,
  ],
})
export class AppModule {}
