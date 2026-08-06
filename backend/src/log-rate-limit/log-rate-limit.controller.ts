import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/jwt-auth/jwt-auth.guard';
import { ApiEnvelopedPaginatedResponse } from '../common/response/api-envelope.decorator';
import { RoleCode } from '../common/roles/role-code.enum';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { LogRateLimitListQueryDto } from './dto/log-rate-limit-list-query.dto';
import { LogRateLimitListItemDto } from './dto/log-rate-limit-response.dto';
import { LogRateLimitService } from './log-rate-limit.service';

/**
 * 16_MENU_PERMISSION.md 2.6 — GET /coupon-rate-limit-logs 1개 엔드포인트. `log-audit`와
 * 동일하게 SUPER_ADMIN + DEVELOPER(본인 소속 회사 + 역할보유(role_code<=20) 배정 프로젝트로
 * 스코핑, 상세 로직은 `LogRateLimitService` 참고)만 접근 가능하고 MANAGER/OPERATOR는 관리메뉴
 * 자체에 접근 권한이 없어 대상 아니다.
 *
 * @author trisakion
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER)
@Controller('coupon-rate-limit-logs')
export class LogRateLimitController {
  constructor(private readonly logRateLimitService: LogRateLimitService) {}

  @Get()
  @ApiEnvelopedPaginatedResponse(LogRateLimitListItemDto)
  list(
    @Query() query: LogRateLimitListQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId, roleCode, companyId } = req.user!;
    return this.logRateLimitService.list(query, {
      userId,
      roleCode,
      companyId,
    });
  }
}
