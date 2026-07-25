import { Module } from '@nestjs/common';
import { CampaignExpiryService } from './campaign-expiry.service';

/**
 * 사용기간 만료 캠페인 자동 종료 배치 모듈. 서버 기동과 함께 자동으로 크론이 등록되므로
 * 다른 모듈이 직접 참조할 필요는 없다(providers만 등록, `NonceCleanupModule`과 동일 구조).
 *
 * @author trisakion
 */
@Module({
  providers: [CampaignExpiryService],
})
export class CampaignExpiryModule {}
