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
import { CompanyService } from './company.service';
import { CompanyListQueryDto } from './dto/company-list-query.dto';
import { CompanyLookupQueryDto } from './dto/company-lookup-query.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

/**
 * 10_COMPANY_API.md 6개 엔드포인트. 2장(관리메뉴)은 SUPER_ADMIN 전용, 3.1(헤더 데이터)은
 * 전체 역할, 2.5(코드 조회)는 인증 불필요. `active-header-data`/`lookup`은 정적 경로라
 * `:company_id` 동적 라우트보다 반드시 먼저 등록한다(10_COMPANY_API.md 2.5/3.1 참고).
 *
 * @author trisakion
 */
@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @UseGuards(JwtAuthGuard)
  @Get('active-header-data')
  getActiveHeaderData(@Req() req: AuthenticatedRequest) {
    const { userId, roleCode, companyId } = req.user!;
    return this.companyService.getActiveHeaderData(userId, roleCode, companyId);
  }

  @Get('lookup')
  lookup(@Query() query: CompanyLookupQueryDto) {
    return this.companyService.lookup(query.company_code);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Post()
  @HttpCode(200)
  create(@Body() dto: CreateCompanyDto, @Req() req: AuthenticatedRequest) {
    return this.companyService.create(dto, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Get()
  list(@Query() query: CompanyListQueryDto, @Req() req: AuthenticatedRequest) {
    return this.companyService.list(query, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Get(':company_id')
  getById(
    @Param('company_id', ParseIntPipe) companyId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.companyService.getById(companyId, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Patch(':company_id')
  @HttpCode(200)
  update(
    @Param('company_id', ParseIntPipe) companyId: number,
    @Body() dto: UpdateCompanyDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.companyService.update(companyId, dto, req.user!.userId);
  }
}
