import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/jwt-auth/jwt-auth.guard';
import { UserRoleService } from './user-role.service';

/** GET /user-roles/me 쿼리 파라미터. */
class GetMyRoleQueryDto {
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  project_id!: number;
}

/**
 * 11_PROJECT_API.md 3.1 — 전체 역할이 호출 가능(JwtAuthGuard만, RolesGuard 없음).
 *
 * @author trisakion
 */
@Controller('user-roles')
export class UserRoleController {
  constructor(private readonly userRoleService: UserRoleService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyRole(
    @Query() query: GetMyRoleQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { userId, roleCode } = req.user!;
    return this.userRoleService.getMyRoleForProject(
      userId,
      roleCode,
      query.project_id,
    );
  }
}
