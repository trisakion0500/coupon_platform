import { ApiProperty } from '@nestjs/swagger';

/**
 * POST /auth/refresh 응답. 09_AUTH_API.md 7장 — Access Token만 재발급하고
 * Refresh Token은 그대로 유지된다(응답에 포함되지 않음).
 *
 * @author trisakion
 */
export class RefreshResponseDto {
  @ApiProperty({
    description: 'Access Token(JWT)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  access_token!: string;

  @ApiProperty({
    description: 'Access Token 만료일시',
    example: '2026-07-26 11:00:00',
  })
  expired_at!: string;

  @ApiProperty({ description: '역할 코드', enum: [10, 20, 30, 40] })
  role_code!: number;
}
