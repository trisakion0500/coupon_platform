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
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserListQueryDto } from './dto/user-list-query.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserService } from './user.service';

/**
 * 14_USER_API.md 1장(User) 7개 엔드포인트. 1.1~1.3(목록/상세)은 SUPER_ADMIN+DEVELOPER(DEVELOPER는
 * 서비스 레이어에서 회사 단위로 스코핑), 나머지(승인/반려/수정/비번초기화)는 SUPER_ADMIN 전용이다.
 *
 * @author trisakion
 */
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER)
  @Get()
  @ApiEnvelopedPaginatedResponse(UserResponseDto)
  list(@Query() query: UserListQueryDto, @Req() req: AuthenticatedRequest) {
    const { userId, roleCode, companyId } = req.user!;
    return this.userService.list(query, { userId, roleCode, companyId });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN, RoleCode.DEVELOPER)
  @Get(':user_id')
  @ApiEnvelopedResponse(UserResponseDto)
  getById(
    @Param('user_id', ParseIntPipe) userId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    const { roleCode, companyId } = req.user!;
    return this.userService.getById(userId, {
      userId: req.user!.userId,
      roleCode,
      companyId,
    });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Post(':user_id/approve')
  @HttpCode(200)
  @ApiEnvelopedResponse(UserResponseDto)
  approve(
    @Param('user_id', ParseIntPipe) userId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.userService.approve(userId, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Post(':user_id/reject')
  @HttpCode(200)
  @ApiEnvelopedResponse(UserResponseDto)
  reject(
    @Param('user_id', ParseIntPipe) userId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.userService.reject(userId, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Patch(':user_id')
  @HttpCode(200)
  @ApiEnvelopedResponse(UserResponseDto)
  update(
    @Param('user_id', ParseIntPipe) userId: number,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.userService.update(userId, dto, req.user!.userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RoleCode.SUPER_ADMIN)
  @Post(':user_id/reset-password')
  @HttpCode(200)
  @ApiEnvelopedResponse(UserResponseDto)
  resetPassword(
    @Param('user_id', ParseIntPipe) userId: number,
    @Body() dto: ResetPasswordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.userService.resetPassword(userId, dto, req.user!.userId);
  }
}
