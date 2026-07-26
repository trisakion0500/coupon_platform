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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/jwt-auth/jwt-auth.guard';
import {
  ApiEnvelopedPaginatedResponse,
  ApiEnvelopedResponse,
} from '../common/response/api-envelope.decorator';
import { RoleCode } from '../common/roles/role-code.enum';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { CampaignCodeService } from './campaign-code.service';
import { CampaignService } from './campaign.service';
import { ApproveCampaignDto } from './dto/approve-campaign.dto';
import { CampaignLogListQueryDto } from './dto/campaign-log-list-query.dto';
import {
  CampaignListItemDto,
  CampaignLogListItemDto,
  CampaignResponseDto,
  UsageListItemDto,
} from './dto/campaign-response.dto';
import { ChangeCampaignStatusDto } from './dto/change-campaign-status.dto';
import { CampaignListQueryDto } from './dto/campaign-list-query.dto';
import { CodeListQueryDto } from './dto/code-list-query.dto';
import {
  AbortCodeGenerationResultDto,
  CodeListItemDto,
  IssueCodesResultDto,
  RetryCodesResultDto,
} from './dto/code-response.dto';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { IssueCodesDto } from './dto/issue-codes.dto';
import { RejectCampaignDto } from './dto/reject-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { UsageListQueryDto } from './dto/usage-list-query.dto';

/**
 * 17_CAMPAIGN_API.md 2장(Campaign) 7개 + 3장(Coupon Code Issuance) 4개 + 4장(Coupon Usage
 * History) 1개 엔드포인트.
 * company/project/user 도메인과 달리 SUPER_ADMIN/DEVELOPER/MANAGER/OPERATOR 전부 project_id
 * 단위로만 스코핑하므로(1.2), 승인/반려를 제외한 나머지는 4개 role 전부를 컨트롤러 레벨에서
 * 허용하고 실제 프로젝트 배정 재검증은 SP가 담당한다. 승인/반려는 OPERATOR가 원천적으로
 * 불가능하므로(2.6/2.7 Permission) 컨트롤러 레벨에서도 미리 걸러 불필요한 DB 왕복 없이 20001을
 * 반환한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2와 같은 원칙을 앱 레이어에도 적용). 코드
 * 발급(3.1/3.2/3.3)은 승인 여부와 무관하게 4개 role 전부 호출 가능하다(05_COUPON_ISSUANCE_SCENARIO.md
 * 1장) — 단 3.4(Abort)는 승인/반려와 동일하게 OPERATOR를 제외한다(시스템이 자동으로 못 정하는 걸
 * 사람이 강제로 결정하는 급의 판단이라서).
 *
 * @author trisakion
 */
@Controller('campaigns')
export class CampaignController {
  constructor(
    private readonly campaignService: CampaignService,
    private readonly campaignCodeService: CampaignCodeService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Post()
  @HttpCode(200)
  @ApiEnvelopedResponse(CampaignResponseDto)
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
  @ApiEnvelopedPaginatedResponse(CampaignListItemDto)
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
  @ApiEnvelopedResponse(CampaignResponseDto)
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
  @ApiEnvelopedResponse(CampaignResponseDto)
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
  @ApiEnvelopedResponse(CampaignResponseDto)
  changeStatus(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Body() dto: ChangeCampaignStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignService.changeStatus(campaignId, dto, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER, RoleCode.MANAGER)
  @Post(':coupon_campaign_id/approve')
  @HttpCode(200)
  @ApiEnvelopedResponse(CampaignResponseDto)
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
  @ApiEnvelopedResponse(CampaignResponseDto)
  reject(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Body() dto: RejectCampaignDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignService.reject(campaignId, dto, req.user!.userId);
  }

  /**
   * FIXED는 동기 처리 완료(200), RANDOM은 백그라운드 생성 시작(202) — 응답 셰이프가 role마다
   * 다른 게 아니라 code_type마다 달라 정적 @HttpCode로 못 정한다. `@Res({passthrough:true})`로
   * status만 직접 지정하고, 반환값은 그대로 ResponseInterceptor를 거쳐 {result,data}로 감싸진다.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Post(':coupon_campaign_id/codes')
  @ApiEnvelopedResponse(IssueCodesResultDto, {
    status: 200,
    description: 'FIXED(동기 완료)',
  })
  @ApiEnvelopedResponse(IssueCodesResultDto, {
    status: 202,
    description: 'RANDOM(비동기 시작)',
  })
  async issueCodes(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Body() dto: IssueCodesDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.campaignCodeService.issueCodes(
      campaignId,
      dto,
      req.user!.userId,
    );
    res.status(result.coupon_code ? 200 : 202);
    return result;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Post(':coupon_campaign_id/codes/retry')
  @HttpCode(200)
  @ApiEnvelopedResponse(RetryCodesResultDto)
  retryCodeIssuance(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignCodeService.retryCodeIssuance(
      campaignId,
      req.user!.userId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Get(':coupon_campaign_id/codes')
  @ApiEnvelopedPaginatedResponse(CodeListItemDto)
  listCodes(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Query() query: CodeListQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignCodeService.listCodes(campaignId, query, {
      userId: req.user!.userId,
    });
  }

  /**
   * 진행중(generation_status=2) 정체 캠페인 수동 복구(17_CAMPAIGN_API.md 3.4). 승인/반려와
   * 동일한 급의 판단이라 그 권한 범위(OPERATOR 제외)를 그대로 따른다 — 다른 코드 발급
   * 엔드포인트(3.1/3.2/3.3)와 달리 4개 role 전부를 허용하지 않는다.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER, RoleCode.MANAGER)
  @Post(':coupon_campaign_id/codes/abort')
  @HttpCode(200)
  @ApiEnvelopedResponse(AbortCodeGenerationResultDto)
  abortCodeGeneration(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignCodeService.abortCodeGeneration(
      campaignId,
      req.user!.userId,
    );
  }

  /** 캠페인별 쿠폰 사용 이력 조회(17_CAMPAIGN_API.md 4.1) — 조회 전용, 승인/종료여부 무관. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Get(':coupon_campaign_id/usages')
  @ApiEnvelopedPaginatedResponse(UsageListItemDto)
  listUsages(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Query() query: UsageListQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignService.listUsages(campaignId, query, {
      userId: req.user!.userId,
    });
  }

  /** 캠페인 변경 이력 조회(17_CAMPAIGN_API.md 4.2) — 조회 전용, 승인/종료여부 무관. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(
    RoleCode.SUPER_ADMIN,
    RoleCode.DEVELOPER,
    RoleCode.MANAGER,
    RoleCode.OPERATOR,
  )
  @Get(':coupon_campaign_id/logs')
  @ApiEnvelopedPaginatedResponse(CampaignLogListItemDto)
  listLogs(
    @Param('coupon_campaign_id', ParseIntPipe) campaignId: number,
    @Query() query: CampaignLogListQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.campaignService.listLogs(campaignId, query, {
      userId: req.user!.userId,
    });
  }
}
