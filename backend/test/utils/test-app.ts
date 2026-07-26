import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { HttpExceptionFilter } from '../../src/common/response/http-exception.filter';
import { ResponseInterceptor } from '../../src/common/response/response.interceptor';
import { TimeoutInterceptor } from '../../src/common/response/timeout.interceptor';
import { applyE2eEnvOverrides } from './env';

/**
 * `main.ts`의 부트스트랩(버전관리/전역 파이프·필터·인터셉터)을 그대로 재현해, 실제 서버와 동일한
 * 응답 셰이프로 E2E 검증할 수 있게 한다. `app.listen()`은 호출하지 않고 supertest가
 * `app.getHttpServer()`로 내부 HTTP 서버를 직접 구동한다 — 포트 충돌 없이 로컬에 이미 떠 있는
 * 개발 서버와 나란히 실행 가능하다.
 *
 * @author trisakion
 */
export async function createE2eApp(): Promise<INestApplication> {
  // AppModule이 컴파일되기 전에 반드시 먼저 호출해야 한다 — ConfigModule.forRoot()가 내부적으로
  // .env를 로드할 때 이미 process.env에 있는 값은 덮어쓰지 않는 dotenv 특성을 이용해
  // .env.test(있으면)를 .env보다 우선 적용한다(env.ts 참고).
  applyE2eEnvOverrides();

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  // rawBody: true — main.ts와 동일하게 켜야 한다. 없으면 request.rawBody가 항상 undefined라
  // S2sAuthGuard가 서명 대상 문자열을 빈 바디로 계산해, 실제 바디가 있는 모든 S2S 요청의
  // 서명검증이 항상 실패한다(coupon-usage.e2e-spec.ts 최초 실행에서 실제로 재현됨, 2026-07-26).
  const app = moduleRef.createNestApplication({ rawBody: true });
  const configService = app.get(ConfigService);

  app.enableVersioning({ type: VersioningType.URI });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter(configService));
  app.useGlobalInterceptors(
    new ResponseInterceptor(),
    new TimeoutInterceptor(
      configService.get<number>('API_EXECUTION_TIMEOUT_MS') ?? 30000,
    ),
  );

  await app.init();
  return app;
}
