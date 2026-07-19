import { Global, Module } from '@nestjs/common';
import { SpExecutorService } from './sp-executor.service';

/**
 * DB 접근 공용 모듈. `SpExecutorService`를 전역(`@Global`)으로 노출해
 * 다른 모듈이 매번 import하지 않아도 주입받을 수 있게 한다.
 *
 * @author trisakion
 */
@Global()
@Module({
  providers: [SpExecutorService],
  exports: [SpExecutorService],
})
export class DatabaseModule {}
