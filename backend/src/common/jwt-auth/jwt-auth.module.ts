import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * JWT 설정(비밀키/Access Token 만료시간)을 등록하고 `JwtAuthGuard`를 노출한다.
 * `JwtModule`도 함께 재노출해 `AuthService`가 같은 설정으로 토큰을 발급할 수 있게 한다.
 *
 * @author trisakion
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.getOrThrow<string>(
            'JWT_ACCESS_EXPIRES_IN',
          ) as StringValue,
        },
      }),
    }),
  ],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class JwtAuthModule {}
