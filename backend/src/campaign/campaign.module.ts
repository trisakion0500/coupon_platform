import { Module } from '@nestjs/common';
import { JwtAuthModule } from '../common/jwt-auth/jwt-auth.module';
import { RolesModule } from '../common/roles/roles.module';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';

/**
 * 17_CAMPAIGN_API.md 2장 도메인 모듈 — 캠페인 CRUD + 상태변경 + 승인/반려 7개 엔드포인트.
 *
 * @author trisakion
 */
@Module({
  imports: [JwtAuthModule, RolesModule],
  controllers: [CampaignController],
  providers: [CampaignService],
})
export class CampaignModule {}
