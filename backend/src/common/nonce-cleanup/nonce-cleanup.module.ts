import { Module } from '@nestjs/common';
import { NonceCleanupService } from './nonce-cleanup.service';

/**
 * S2S nonce 정리 배치 모듈. 서버 기동과 함께 자동으로 크론이 등록되므로
 * 다른 모듈이 직접 참조할 필요는 없다(providers만 등록, `SessionCleanupModule`과 동일 구조).
 *
 * @author trisakion
 */
@Module({
  providers: [NonceCleanupService],
})
export class NonceCleanupModule {}
