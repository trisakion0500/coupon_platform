import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { S2sAuthGuard } from './s2s-auth.guard';

/**
 * S2S(게임서버) 컨트롤러가 `S2sAuthGuard`를 사용하려면 이 모듈을 import한다.
 *
 * @author trisakion
 */
@Module({
  imports: [CryptoModule],
  providers: [S2sAuthGuard],
  exports: [S2sAuthGuard],
})
export class S2sAuthModule {}
