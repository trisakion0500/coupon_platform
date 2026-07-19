import { Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/**
 * 암호화/서명 유틸(`CryptoService`)이 필요한 모듈이 명시적으로 import한다.
 *
 * @author trisakion
 */
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
