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
import { RoleCode } from '../common/roles/role-code.enum';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { LogAuditListQueryDto } from './dto/log-audit-list-query.dto';
import { LogAuditService } from './log-audit.service';

/**
 * 13_LOG_AUDIT_API.md 4장 — GET /log-audits(목록), GET /log-audits/{idx}(상세) 2개
 * 엔드포인트. 둘 다 SUPER_ADMIN + DEVELOPER(본인 소속 회사로 스코핑)만 접근 가능하고
 * MANAGER/OPERATOR는 관리메뉴 자체에 접근 권한이 없어 대상 아니다(3장).
 *
 * @author trisakion
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER)
@Controller('log-audits')
export class LogAuditController {
  constructor(private readonly logAuditService: LogAuditService) {}

  @Get()
  list(@Query() query: LogAuditListQueryDto, @Req() req: AuthenticatedRequest) {
    const { roleCode, companyId } = req.user!;
    return this.logAuditService.list(query, { roleCode, companyId });
  }

  @Get(':idx')
  getById(
    @Param('idx', ParseIntPipe) idx: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const { roleCode, companyId } = req.user!;
    return this.logAuditService.getById(idx, { roleCode, companyId });
  }
}
