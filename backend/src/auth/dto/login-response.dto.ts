import { ApiProperty } from '@nestjs/swagger';

/**
 * POST /auth/login 응답. 11_AUTH_API.md 5장 — 세션 생성 시 Access/Refresh Token을 함께 발급한다.
 *
 * @author trisakion
 */
export class LoginResponseDto {
  @ApiProperty({
    description: 'Access Token(JWT)',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  access_token!: string;

  @ApiProperty({
    description: 'Refresh Token',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  refresh_token!: string;

  @ApiProperty({
    description: 'Access Token 만료일시',
    example: '2026-07-26 11:00:00',
  })
  expired_at!: string;

  @ApiProperty({ description: '역할 코드', enum: [10, 20, 30, 40] })
  role_code!: number;
}
