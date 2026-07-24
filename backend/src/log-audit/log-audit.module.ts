import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../common/jwt-auth/jwt-auth.module';
import { RolesModule } from '../common/roles/roles.module';
import { LogAuditController } from './log-audit.controller';
import { LogAuditService } from './log-audit.service';

/**
 * 감사 로그 조회(13_LOG_AUDIT_API.md) 모듈. `SpExecutorService`/`LogSpExecutorService`는
 * `DatabaseModule`/`LogDatabaseModule`이 전역으로 노출하므로 여기서 별도 import가 필요 없지만
 * (`SpExecutorService`는 DEVELOPER의 project/user_role 로그 스코핑용 배정 프로젝트 조회에
 * 2026-07-24 추가로 쓰이게 됐다), 컨트롤러가 쓰는 `JwtAuthGuard`/`RolesGuard`는 각자의 의존
 * 모듈(`JwtModule` 등)을 함께 재노출하는 `JwtAuthModule`/`RolesModule`을 직접 import해야 한다 —
 * 가드는 자신이 선언된 모듈이 아니라 사용하는 컨트롤러가 속한 모듈의 DI 컨테이너에서 의존성을
 * 해석하기 때문이다(ProjectModule과 동일 패턴, S2sAuthModule 최초 재사용 때 겪었던 DI 버그와
 * 같은 원인).
 *
 * @author trisakion
 */
@Module({
  imports: [JwtAuthModule, RolesModule],
  controllers: [LogAuditController],
  providers: [LogAuditService],
})
export class LogAuditModule {}
