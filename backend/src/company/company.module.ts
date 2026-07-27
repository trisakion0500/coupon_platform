import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../common/jwt-auth/jwt-auth.module';
import { RolesModule } from '../common/roles/roles.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

/**
 * 12_COMPANY_API.md 도메인 모듈 — 회사 CRUD + 코드 조회 + 헤더 데이터 6개 엔드포인트.
 *
 * @author trisakion
 */
@Module({
  imports: [JwtAuthModule, RolesModule],
  controllers: [CompanyController],
  providers: [CompanyService],
})
export class CompanyModule {}
