import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { S2sAuthGuard } from './s2s-auth.guard';

/**
 * S2S(게임서버) 컨트롤러가 `S2sAuthGuard`를 사용하려면 이 모듈을 import한다.
 * `CryptoModule`도 함께 재노출한다 — `@UseGuards(S2sAuthGuard)`처럼 클래스 참조로 가드를 걸면
 * Nest는 컨트롤러가 속한 모듈(예: `CouponUsageModule`)의 DI 컨테이너에서 그 가드의 생성자
 * 의존성(`CryptoService`)까지 직접 해석 가능해야 한다 — `JwtAuthModule`이 `JwtAuthGuard`뿐
 * 아니라 `JwtModule`도 함께 export하는 것과 동일한 이유(2026-07-22, `CouponUsageModule`에서
 * 이 가드를 처음 재사용하며 발견 - `SpExecutorService`/`ConfigService`는 전역 모듈이라 문제
 * 없었지만 `CryptoModule`만 export가 빠져 `UnknownDependenciesException`이 났었음).
 *
 * @author trisakion
 */
@Module({
  imports: [CryptoModule],
  providers: [S2sAuthGuard],
  exports: [S2sAuthGuard, CryptoModule],
})
export class S2sAuthModule {}
