import { Module } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

/**
 * `RolesGuard`를 노출하는 모듈. `Reflector`는 Nest 코어가 전역으로 주입 가능하게 해줘
 * 별도 provider 등록이 필요 없다(`JwtAuthModule`과 같은 패턴).
 *
 * @author trisakion
 */
@Module({
  providers: [RolesGuard],
  exports: [RolesGuard],
})
export class RolesModule {}
