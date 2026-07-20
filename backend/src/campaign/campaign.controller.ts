import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/jwt-auth/jwt-auth.guard';
import { RoleCode } from '../common/roles/role-code.enum';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { CampaignService } from './campaign.service';
import { ApproveCampaignDto } from './dto/approve-campaign.dto';
import { ChangeCampaignStatusDto } from './dto/change-campaign-status.dto';
import { CampaignListQueryDto } from './dto/campaign-list-query.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { RejectCampaignDto } from './dto/reject-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

/**
 * 17_CAMPAIGN_API.md 2장(Campaign) 7개 엔드포인트. company/project/user 도메인과 달리
 * SUPER_ADMIN/DEVELOPER/MANAGER/OPERATOR 전부 project_id 단위로만 스코핑하므로(1.2), 승인/반려를
 * 제외한 나머지는 4개 role 전부를 컨트롤러 레벨에서 허용하고 실제 프로젝트 배정 재검증은 SP가
 * 담당한다. 승인/반려는 OPERATOR가 원천적으로 불가능하므로(2.6/2.7 Permission) 컨트롤러
 * 레벨에서도 미리 걸러 불필요한 DB 왕복 없이 20001을 반환한다(방어적 이중 체크,
 * 02_DEV_CONVENTIONS.md 3.2와 같은 원칙을 앱 레이어에도 적용).
 *
 * @author trisakion
 */
@Controller('campaigns')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Post()
  @HttpCode(200)
  create(@Body() dto: CreateCampaignDto, @Req() req: AuthenticatedRequest) {
    return this.campaignService.create(dto, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Get()
  list(@Query() query: CampaignListQueryDto, @Req() req: AuthenticatedRequest) {
    return this.campaignService.list(query, { userId: req.user!.userId });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Get(':coupon_campaign_id')
  getById(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignService.getById(campaignId, {
      userId: req.user!.userId,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Patch(':coupon_campaign_id')
  @HttpCode(200)
  update(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Body() dto: UpdateCampaignDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignService.update(campaignId, dto, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Post(':coupon_campaign_id/status')
  @HttpCode(200)
  changeStatus(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Body() dto: ChangeCampaignStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignService.changeStatus(
      campaignId,
      dto,
      req.user!.userId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER, RoleCode.MANAGER)
  @Post(':coupon_campaign_id/approve')
  @HttpCode(200)
  approve(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Body() dto: ApproveCampaignDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignService.approve(campaignId, dto, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER, RoleCode.MANAGER)
  @Post(':coupon_campaign_id/reject')
  @HttpCode(200)
  reject(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Body() dto: RejectCampaignDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignService.reject(campaignId, dto, req.user!.userId);
  }
}
