import { Module } from '@nestjs/common';
import { ApiSecretCleanupService } from './api-secret-cleanup.service';

/**
 * project.api_secret_prev 정리 배치 모듈. 서버 기동과 함께 자동으로 크론이 등록되므로
 * 다른 모듈이 직접 참조할 필요는 없다(providers만 등록).
 *
 * @author trisakion
 */
@Module({
  providers: [ApiSecretCleanupService],
})
export class ApiSecretCleanupModule {}
