import { ApiProperty } from '@nestjs/swagger';

/** GET /config/public 응답. 10_API_COMMON.md 6.2. */
export class PublicConfigResponseDto {
  @ApiProperty({ description: 'API Secret 재발급 유예기간(일)', example: 7 })
  api_secret_grace_period_days!: number;
}
