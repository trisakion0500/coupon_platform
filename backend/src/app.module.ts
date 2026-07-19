import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { CompanyModule } from './company/company.module';
import { ApiSecretCleanupModule } from './common/api-secret-cleanup/api-secret-cleanup.module';
import { envValidationSchema } from './common/config/env.validation';
import { DatabaseModule } from './common/database/database.module';
import { LogDatabaseModule } from './common/database/log-database.module';
import { SessionCleanupModule } from './common/session-cleanup/session-cleanup.module';
import { HealthModule } from './health/health.module';
import { ProjectModule } from './project/project.module';
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
    SessionCleanupModule,
    ApiSecretCleanupModule,
    HealthModule,
    AuthModule,
    CompanyModule,
    ProjectModule,
    UserRoleModule,
  ],
})
export class AppModule {}
