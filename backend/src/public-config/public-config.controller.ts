import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiEnvelopedResponse } from '../common/response/api-envelope.decorator';
import { PublicConfigResponseDto } from './dto/public-config-response.dto';

interface PublicConfigResponse {
  api_secret_grace_period_days: number;
}

/**
 * 10_API_COMMON.md 6.2: 인증 불필요, 프론트가 화면 문구에 그대로 노출해야 하는 env 설정값 전용.
 * 민감정보가 아닌 값만 여기 추가한다 — `.env` 원본을 그대로 반환하는 범용 엔드포인트가 아니다.
 *
 * @author trisakion
 */
@Controller('config')
export class PublicConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get('public')
  @ApiEnvelopedResponse(PublicConfigResponseDto)
  getPublicConfig(): PublicConfigResponse {
    return {
      api_secret_grace_period_days: this.configService.getOrThrow<number>(
        'API_SECRET_GRACE_PERIOD_DAYS',
      ),
    };
  }
}
