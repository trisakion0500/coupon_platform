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
import { Transform } from 'class-transformer';
import { IsInt } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/jwt-auth/jwt-auth.guard';
import { RoleCode } from '../common/roles/role-code.enum';
import { Roles } from '../common/roles/roles.decorator';
import { RolesGuard } from '../common/roles/roles.guard';
import { CreateUserRoleDto } from './dto/create-user-role.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UserRoleListQueryDto } from './dto/user-role-list-query.dto';
import { UserRoleService } from './user-role.service';

/** GET /user-roles/me 쿼리 파라미터. */
class GetMyRoleQueryDto {
  @Transform(({ value }) => parseInt(value as string, 10))
  @IsInt()
  project_id!: number;
}

/**
 * 11_PROJECT_API.md 3.1 `GET /user-roles/me`(전체 역할, JwtAuthGuard만) +
 * 12_USER_API.md 3장(User Role) 생성/목록/수정(SUPER_ADMIN 전용) 4개 엔드포인트.
 * `me`는 정적 경로라 파라미터를 받는 다른 라우트와 겹치지 않는다.
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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Post()
  @HttpCode(200)
  create(@Body() dto: CreateUserRoleDto) {
    return this.userRoleService.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Get()
  list(@Query() query: UserRoleListQueryDto) {
    return this.userRoleService.list(query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Patch(':user_id/:project_id')
  @HttpCode(200)
  update(
    @Param('user_id', ParseIntPipe) userId: number,
    @Param('project_id', ParseIntPipe) projectId: number,
    @Body() dto: UpdateUserRoleDto,
  ) {
    return this.userRoleService.update(userId, projectId, dto);
  }
}
