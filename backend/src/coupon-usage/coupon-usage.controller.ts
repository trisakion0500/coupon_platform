import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import type { S2sRequest } from '../common/s2s-auth/s2s-auth.guard';
import {
  ApiResponseEnvelopeDto,
  PaginatedEnvelopeMetaDto,
} from '../common/response/api-envelope.dto';
import { ApiEnvelopedResponse } from '../common/response/api-envelope.decorator';
import { S2sAuthGuard } from '../common/s2s-auth/s2s-auth.guard';
import { CouponUsageService } from './coupon-usage.service';
import { ConfirmCouponDto } from './dto/confirm-coupon.dto';
import {
  ConfirmResultDto,
  ReserveResultDto,
  UnconfirmedItemDto,
} from './dto/coupon-usage-response.dto';
import { ReserveCouponDto } from './dto/reserve-coupon.dto';
import { UnconfirmedQueryDto } from './dto/unconfirmed-query.dto';

/**
 * 20_COUPON_USAGE_API.md 2장(Reserve/Confirm) + 3장(미컨슘 조회) 3개 엔드포인트. 게임서버가
 * S2S(API Key+HMAC 서명)로 호출하는 도메인이라 `JwtAuthGuard`/`RolesGuard`가 아니라
 * `S2sAuthGuard`를 쓰고, `project_id`는 관리 콘솔처럼 쿼리/바디로 받지 않고 이 가드가 인증한
 * 값(`request.s2sProject.projectId`)을 그대로 서비스에 전달한다(1.2). 09_AUTH_SECURITY.md
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
  @ApiEnvelopedResponse(ReserveResultDto)
  reserve(
    @Param('code') code: string,
    @Body() dto: ReserveCouponDto,
    @Req() req: S2sRequest,
  ) {
    return this.couponUsageService.reserve(
      req.s2sProject!.projectId,
      req.s2sProject!.companyCode,
      req.s2sProject!.projectCode,
      code,
      dto.game_user_id,
      req.ip ?? null,
    );
  }

  @UseGuards(S2sAuthGuard)
  @Post(':code/confirm')
  @HttpCode(200)
  @ApiEnvelopedResponse(ConfirmResultDto)
  confirm(
    @Param('code') code: string,
    @Body() dto: ConfirmCouponDto,
    @Req() req: S2sRequest,
  ) {
    return this.couponUsageService.confirm(
      req.s2sProject!.projectId,
      req.s2sProject!.companyCode,
      req.s2sProject!.projectCode,
      code,
      dto.game_user_id,
      req.ip ?? null,
    );
  }

  @UseGuards(S2sAuthGuard)
  @Post('unconfirmed')
  @HttpCode(200)
  @ApiExtraModels(
    ApiResponseEnvelopeDto,
    PaginatedEnvelopeMetaDto,
    UnconfirmedItemDto,
  )
  @ApiResponse({
    status: 200,
    description:
      'game_user_id 지정 시 items만 반환(페이지네이션 없음), 미지정 시 페이지네이션 포함 전체 반환',
    schema: {
      allOf: [
        { $ref: getSchemaPath(ApiResponseEnvelopeDto) },
        {
          properties: {
            data: {
              oneOf: [
                {
                  properties: {
                    items: {
                      type: 'array',
                      items: { $ref: getSchemaPath(UnconfirmedItemDto) },
                    },
                  },
                },
                {
                  allOf: [
                    { $ref: getSchemaPath(PaginatedEnvelopeMetaDto) },
                    {
                      properties: {
                        items: {
                          type: 'array',
                          items: { $ref: getSchemaPath(UnconfirmedItemDto) },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
  })
  listUnconfirmed(@Body() query: UnconfirmedQueryDto, @Req() req: S2sRequest) {
    return this.couponUsageService.listUnconfirmed(
      req.s2sProject!.projectId,
      query,
    );
  }
}
