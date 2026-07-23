import { Module } from '@nestjs/common';
import { CodeGenerationStaleMonitorService } from './code-generation-stale-monitor.service';

/**
 * 정체된 코드생성 job 감지 모니터링 크론 모듈. 서버 기동과 함께 자동으로 크론이 등록되므로
 * 다른 모듈이 직접 참조할 필요는 없다(providers만 등록, `SessionCleanupModule`과 동일 구조).
 *
 * @author trisakion
 */
@Module({
  providers: [CodeGenerationStaleMonitorService],
})
export class CodeGenerationStaleMonitorModule {}
