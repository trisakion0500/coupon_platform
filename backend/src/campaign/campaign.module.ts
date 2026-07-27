import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../common/jwt-auth/jwt-auth.module';
import { RolesModule } from '../common/roles/roles.module';
import { CampaignCodeService } from './campaign-code.service';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

/**
 * 19_CAMPAIGN_API.md 2장(캠페인 CRUD+상태변경+승인/반려) + 3장(코드발급) + 4장(조회/로그)
 * 도메인 모듈. `CampaignService`(2/4장)와 `CampaignCodeService`(3장, 2026-07-24 분리)가 같은
 * 컨트롤러를 나눠 쓴다.
 *
 * @author trisakion
 */
@Module({
  imports: [JwtAuthModule, RolesModule],
  controllers: [CampaignController],
  providers: [CampaignService, CampaignCodeService],
})
export class CampaignModule {}
