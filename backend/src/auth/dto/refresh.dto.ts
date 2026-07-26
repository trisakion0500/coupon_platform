import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

/**
 * POST /auth/refresh 요청 바디.
 *
 * @author trisakion
 */
export class RefreshDto {
  @ApiProperty({
    description: 'Refresh Token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  refresh_token!: string;
}
