import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/jwt-auth/jwt-auth.guard';
import { RoleCode } from '../common/roles/role-code.enum';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { CouponUseLogListQueryDto } from './dto/coupon-use-log-list-query.dto';
import { CouponUseLogService } from './coupon-use-log.service';

/**
 * 17_CAMPAIGN_API.md 4.3 — GET /coupon-use-logs 1개 엔드포인트. 캠페인 도메인과 동일하게
 * project_id 단위 스코핑이라(1.2) 4개 role 전부 접근 가능.
 *
 * @author trisakion
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(
  RoleCode.SUPER_ADMIN,
  RoleCode.DEVELOPER,
  RoleCode.MANAGER,
  RoleCode.OPERATOR,
)
@Controller('coupon-use-logs')
export class CouponUseLogController {
  constructor(private readonly couponUseLogService: CouponUseLogService) {}

  @Get()
  list(
    @Query() query: CouponUseLogListQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.couponUseLogService.list(query, {
      userId: req.user!.userId,
    });
  }
}
