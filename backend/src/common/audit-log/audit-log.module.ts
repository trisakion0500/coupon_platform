import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * 감사 로그 적재 공용 모듈. `AuditLogService`를 전역(`@Global`)으로 노출해 company/project/
 * user/user-role/auth 등 여러 도메인 모듈이 매번 import하지 않아도 주입받을 수 있게 한다
 * (`LogDatabaseModule`과 동일한 패턴).
 *
 * @author trisakion
 */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
