import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
import { LogAuditListQueryDto } from './dto/log-audit-list-query.dto';
import {
  LogAuditDetailDto,
  LogAuditListItemDto,
} from './dto/log-audit-response.dto';
import { LogAuditService } from './log-audit.service';

/**
 * 13_LOG_AUDIT_API.md 4장 — GET /log-audits(목록), GET /log-audits/{idx}(상세) 2개
 * 엔드포인트. 둘 다 SUPER_ADMIN + DEVELOPER(본인 소속 회사로 스코핑, `project`/`user_role`
 * 테이블 로그는 실제 role_code<=20으로 배정된 프로젝트로 추가 제한 — 2026-07-24, 상세 로직은
 * `LogAuditService` 참고)만 접근 가능하고 MANAGER/OPERATOR는 관리메뉴 자체에 접근 권한이
 * 없어 대상 아니다(3장).
 *
 * @author trisakion
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER)
@Controller('log-audits')
export class LogAuditController {
  constructor(private readonly logAuditService: LogAuditService) {}

  @Get()
  @ApiEnvelopedPaginatedResponse(LogAuditListItemDto)
  list(@Query() query: LogAuditListQueryDto, @Req() req: AuthenticatedRequest) {
    const { userId, roleCode, companyId } = req.user!;
    return this.logAuditService.list(query, { userId, roleCode, companyId });
  }

  @Get(':idx')
  @ApiEnvelopedResponse(LogAuditDetailDto)
  getById(
    @Param('idx', ParseIntPipe) idx: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId, roleCode, companyId } = req.user!;
    return this.logAuditService.getById(idx, { userId, roleCode, companyId });
  }
}
