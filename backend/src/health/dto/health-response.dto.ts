import { ApiProperty } from '@nestjs/swagger';

/** GET /health 응답. 08_API_COMMON.md 6장. */
export class HealthResponseDto {
  @ApiProperty({ description: '상태', example: 'ok' })
  status!: string;

  @ApiProperty({
    description: '서버 시각(UTC epoch ms)',
    example: 1785000000000,
  })
  server_time!: number;
}
