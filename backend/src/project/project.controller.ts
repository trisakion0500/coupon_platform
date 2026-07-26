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
import {
  ApiEnvelopedPaginatedResponse,
  ApiEnvelopedResponse,
} from '../common/response/api-envelope.decorator';
import { RoleCode } from '../common/roles/role-code.enum';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectListQueryDto } from './dto/project-list-query.dto';
import { ProjectLookupQueryDto } from './dto/project-lookup-query.dto';
import {
  ApiSecretRotateResponseDto,
  ProjectCreateResponseDto,
  ProjectLookupResponseDto,
  ProjectResponseDto,
} from './dto/project-response.dto';
import { RotateApiSecretDto } from './dto/rotate-api-secret.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectService } from './project.service';

/**
 * 11_PROJECT_API.md 6개 엔드포인트. 2.1/2.4(생성/수정)는 SUPER_ADMIN 전용, 2.2/2.3/2.5(목록/상세/
 * Secret재발급)는 SUPER_ADMIN+DEVELOPER(DEVELOPER는 서비스/SP 레이어에서 회사·프로젝트 단위로
 * 추가 스코핑), 2.6(코드 조회)은 인증 불필요. `lookup`은 정적 경로라 `:project_id` 동적 라우트보다
 * 먼저 등록한다(company.controller.ts와 동일 원칙).
 *
 * @author trisakion
 */
@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Get('lookup')
  @ApiEnvelopedResponse(ProjectLookupResponseDto)
  lookup(@Query() query: ProjectLookupQueryDto) {
    return this.projectService.lookup(query.company_id, query.project_code);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Post()
  @HttpCode(200)
  @ApiEnvelopedResponse(ProjectCreateResponseDto)
  create(@Body() dto: CreateProjectDto, @Req() req: AuthenticatedRequest) {
    return this.projectService.create(dto, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER)
  @Get()
  @ApiEnvelopedPaginatedResponse(ProjectResponseDto)
  list(@Query() query: ProjectListQueryDto, @Req() req: AuthenticatedRequest) {
    const { roleCode, companyId } = req.user!;
    return this.projectService.list(query, {
      userId: req.user!.userId,
      roleCode,
      companyId,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER)
  @Get(':project_id')
  @ApiEnvelopedResponse(ProjectResponseDto)
  getById(
    @Param('project_id', ParseIntPipe) projectId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId, roleCode, companyId } = req.user!;
    return this.projectService.getById(projectId, {
      userId,
      roleCode,
      companyId,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Patch(':project_id')
  @HttpCode(200)
  @ApiEnvelopedResponse(ProjectResponseDto)
  update(
    @Param('project_id', ParseIntPipe) projectId: number,
    @Body() dto: UpdateProjectDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.projectService.update(projectId, dto, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER)
  @Post(':project_id/api-secret/rotate')
  @HttpCode(200)
  @ApiEnvelopedResponse(ApiSecretRotateResponseDto)
  rotateApiSecret(
    @Param('project_id', ParseIntPipe) projectId: number,
    @Body() dto: RotateApiSecretDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId, roleCode, companyId } = req.user!;
    return this.projectService.rotateApiSecret(projectId, dto, {
      userId,
      roleCode,
      companyId,
    });
  }
}
