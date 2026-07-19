import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../common/jwt-auth/jwt-auth.guard';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { SignupDto } from './dto/signup.dto';

/**
 * 09_AUTH_API.md 3장의 6개 엔드포인트. signup/login/refresh는 인증 불필요,
 * logout/me/password는 `JwtAuthGuard`로 보호한다.
 *
 * @author trisakion
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @HttpCode(200)
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: AuthenticatedRequest,
  ): Promise<Record<string, never>> {
    await this.authService.logout(req.user!.jti);
    return {};
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMe(@Req() req: AuthenticatedRequest) {
    return this.authService.getMe(req.user!.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('password')
  @HttpCode(200)
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ): Promise<Record<string, never>> {
    await this.authService.changePassword(req.user!.userId, dto);
    return {};
  }
}
