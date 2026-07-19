import { IsString } from 'class-validator';

/**
 * POST /auth/refresh 요청 바디.
 *
 * @author trisakion
 */
export class RefreshDto {
  @IsString()
  refresh_token!: string;
}
