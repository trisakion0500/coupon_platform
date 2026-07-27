import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { Log4jsLogger } from './common/logging/log4js-logger.service';
import { HttpExceptionFilter } from './common/response/http-exception.filter';
import { ResponseInterceptor } from './common/response/response.interceptor';
import { TimeoutInterceptor } from './common/response/timeout.interceptor';

/**
 * 앱 부트스트랩 — 보안 헤더/CORS/버전 관리/전역 파이프·필터·인터셉터를 여기서 한 번에 구성한다.
 *
 * @author trisakion
 */
async function bootstrap() {
  // rawBody: true — S2S HMAC 서명 검증(09_AUTH_SECURITY.md 2.3)이 파싱 후 재직렬화가 아니라
  // 원문 그대로의 바디를 서명 대상으로 요구하기 때문에, Nest가 body-parser의 verify 콜백으로
  // request.rawBody를 채워주도록 켠다.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // SIGTERM/SIGINT(스케일아웃 환경의 롤링 배포/오토스케일 축소가 항상 보냄) 수신 시 Nest가
  // onModuleDestroy 라이프사이클 훅을 호출하도록 등록 — 이게 없으면 SpExecutorService/
  // LogSpExecutorService의 mysql2 pool.end()가 절대 호출되지 않아 커넥션이 안전하게 안 닫힌 채
  // 프로세스가 강제 종료된다.
  app.enableShutdownHooks();

  // 배포 토폴로지상 이 서버 앞에 항상 리버스 프록시/로드밸런서가 정확히 1홉 있다(2026-07-23,
  // log_coupon_use.caller_ip 도입 때 확인) — trust proxy=1로 X-Forwarded-For의 첫 번째 값만
  // 신뢰해야 `req.ip`가 프록시 자신이 아니라 실제 호출자(게임서버) IP를 반환한다. 프록시가 없는
  // 로컬 개발 환경에서는 이 헤더 자체가 없어 안전하게 소켓 IP로 폴백된다.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.useLogger(new Log4jsLogger());

  const configService = app.get(ConfigService);
  const swaggerEnabled = configService.get<boolean>('SWAGGER_ENABLED');

  app.use(
    helmet({
      // 10_API_COMMON.md 5.2: Swagger UI(인라인 스크립트/스타일)를 켤 때만 CSP를 비활성화하고
      // 나머지 보안 헤더(HSTS, X-Frame-Options 등)는 그대로 유지한다.
      contentSecurityPolicy: swaggerEnabled ? false : undefined,
    }),
  );

  const allowedOrigins = configService
    .get<string>('CORS_ALLOWED_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({ origin: allowedOrigins });

  // 09_AUTH_SECURITY.md 2.7: S2S API만 버전 접두어(/v1)를 붙인다. 관리 콘솔 컨트롤러는
  // @Version()을 지정하지 않으면 자동으로 version-neutral로 취급되어 영향받지 않는다.
  app.enableVersioning({ type: VersioningType.URI });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter(configService));
  app.useGlobalInterceptors(
    new ResponseInterceptor(),
    new TimeoutInterceptor(
      configService.get<number>('API_EXECUTION_TIMEOUT_MS') ?? 30000,
    ),
  );

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Coupon Platform API')
      .setDescription('관리 콘솔 API + S2S(게임서버) API')
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(configService.get<number>('PORT') ?? 3000);
}

bootstrap().catch((error: unknown) => {
  console.error('Failed to bootstrap application', error);
  process.exit(1);
});
