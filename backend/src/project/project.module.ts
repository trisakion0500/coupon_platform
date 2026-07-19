import { Module } from '@nestjs/common';
import { CryptoModule } from '../common/crypto/crypto.module';
import { JwtAuthModule } from '../common/jwt-auth/jwt-auth.module';
import { RolesModule } from '../common/roles/roles.module';
import { ProjectController } from './project.controller';
import { ProjectService } from './project.service';

/**
 * 11_PROJECT_API.md 도메인 모듈 — 프로젝트 CRUD + Secret 발급/재발급 + 코드 조회 6개 엔드포인트.
 *
 * @author trisakion
 */
@Module({
  imports: [JwtAuthModule, RolesModule, CryptoModule],
  controllers: [ProjectController],
  providers: [ProjectService],
})
export class ProjectModule {}
