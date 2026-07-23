import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { S2sRequest } from '../common/s2s-auth/s2s-auth.guard';
import { S2sAuthGuard } from '../common/s2s-auth/s2s-auth.guard';
import { CouponUsageService } from './coupon-usage.service';
import { ConfirmCouponDto } from './dto/confirm-coupon.dto';
import { ReserveCouponDto } from './dto/reserve-coupon.dto';
import { UnconfirmedQueryDto } from './dto/unconfirmed-query.dto';

/**
 * 18_COUPON_USAGE_API.md 2장(Reserve/Confirm) + 3장(미컨슘 조회) 3개 엔드포인트. 게임서버가
 * S2S(API Key+HMAC 서명)로 호출하는 도메인이라 `JwtAuthGuard`/`RolesGuard`가 아니라
 * `S2sAuthGuard`를 쓰고, `project_id`는 관리 콘솔처럼 쿼리/바디로 받지 않고 이 가드가 인증한
 * 값(`request.s2sProject.projectId`)을 그대로 서비스에 전달한다(1.2). 07_AUTH_SECURITY.md
 * 2.7 버전 정책에 따라 `/v1` 접두어를 붙인다(1.3).
 *
 * @author trisakion
 */
@Controller({ path: 'coupons', version: '1' })
export class CouponUsageController {
  constructor(private readonly couponUsageService: CouponUsageService) {}

  @UseGuards(S2sAuthGuard)
  @Post(':code/reserve')
  @HttpCode(200)
  reserve(
    @Param('code') code: string,
    @Body() dto: ReserveCouponDto,
    @Req() req: S2sRequest,
  ) {
    return this.couponUsageService.reserve(
      req.s2sProject!.projectId,
      code,
      dto.game_user_id,
      req.ip ?? null,
    );
  }

  @UseGuards(S2sAuthGuard)
  @Post(':code/confirm')
  @HttpCode(200)
  confirm(
    @Param('code') code: string,
    @Body() dto: ConfirmCouponDto,
    @Req() req: S2sRequest,
  ) {
    return this.couponUsageService.confirm(
      req.s2sProject!.projectId,
      code,
      dto.game_user_id,
      req.ip ?? null,
    );
  }

  @UseGuards(S2sAuthGuard)
  @Get('unconfirmed')
  listUnconfirmed(@Query() query: UnconfirmedQueryDto, @Req() req: S2sRequest) {
    return this.couponUsageService.listUnconfirmed(
      req.s2sProject!.projectId,
      query,
    );
  }
}
