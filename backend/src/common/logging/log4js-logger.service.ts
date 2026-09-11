import { LoggerService } from '@nestjs/common';
import * as log4js from 'log4js';
import * as fs from 'fs';
import * as path from 'path';

// 어펜더/카테고리 구성 자체(날짜별 로테이션, ERROR 전용 파일 분리, 정체감지/S2S실패 전용
// 파일 분리 등)는 `backend/log4js.json`으로 분리해뒀다 — 이 파일은 그 JSON을 읽어 인스턴스별
// suffix만 채워넣고 log4js에 적용하는 역할만 한다.
//
// 클러스터(다중 인스턴스) 구동 대비(2026-07-28) — log4js의 dateFile 어펜더는 같은 프로세스
// 안에서의 동시 쓰기만 안전하게 직렬화할 뿐, 여러 OS 프로세스가 파일 하나를 동시에 공유
// 쓰기하는 것까지는 보장하지 않는다. 스케일아웃 환경에서 레플리카가 전부 동일한
// `logs/app.log`를 바라보면 줄이 서로 섞이거나 파일이 깨질 수 있어, 인스턴스 식별자를
// 파일명 suffix로 붙여 인스턴스마다 물리적으로 다른 파일에 쓰게 한다. JSON 자체는 런타임
// 환경변수를 참조할 방법이 없어 `{INSTANCE_SUFFIX}` 플레이스홀더를 문자열 치환으로 채운다.
//
// `.env`(dotenv)가 아니라 실제 프로세스 환경변수에서 직접 읽는다 — 두 가지 이유가 있다.
// (1) 이 파일의 `log4js.configure()`는 모듈 로드 시점에 실행되는데, `AppModule`이 다른 도메인
//     모듈(예: CodeGenerationStaleMonitorModule)을 import하는 과정에서 이 파일이 먼저
//     require되어 `ConfigModule.forRoot()`가 호출되기도 전에 실행된다 — 즉 이 시점엔
//     ConfigService(DI)도, dotenv가 읽어들인 `.env` 값도 아직 쓸 수 없다.
// (2) 설령 타이밍 문제가 없더라도 `.env`는 모든 인스턴스가 공유하는 단일 파일이라 애초에
//     인스턴스별로 다른 값을 담을 수 없다 — 인스턴스 식별자는 프로세스 매니저가 인스턴스마다
//     실제로 다르게 주입해줘야 의미가 있다(PM2 클러스터 모드가 자동으로 넣어주는
//     `NODE_APP_INSTANCE`, 또는 Docker/k8s 등에서 컨테이너별로 직접 지정하는 `INSTANCE_ID`).
//
// 둘 다 없으면(로컬 개발/단일 인스턴스) instanceSuffix는 빈 문자열이라 기존 파일명(`app.log`
// 등)이 그대로 유지된다 — 하위호환.
const instanceId = process.env.INSTANCE_ID ?? process.env.NODE_APP_INSTANCE;
const instanceSuffix = instanceId ? `-${instanceId}` : '';

// `process.cwd()` 기준 — dev(`nest start`)/prod(`node dist/main`) 둘 다 항상 backend 루트에서
// 실행되므로(`package.json` scripts), `.env` 로딩(ConfigModule.forRoot())과 동일한 기준을 쓴다.
const rawConfig = fs.readFileSync(
  path.join(process.cwd(), 'log4js.json'),
  'utf-8',
);
const resolvedConfig = JSON.parse(
  rawConfig.split('{INSTANCE_SUFFIX}').join(instanceSuffix),
) as log4js.Configuration;

log4js.configure(resolvedConfig);

/**
 * 02_TECH_STACK.md의 application log(log4js) 정책 — NestJS LoggerService를 log4js로 위임한다.
 *
 * @author trisakion
 */
export class Log4jsLogger implements LoggerService {
  private readonly logger = log4js.getLogger('app');

  /** info 레벨로 위임(NestJS의 일반 `Logger.log`에 대응). */
  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info(message, ...optionalParams);
  }

  /** error 레벨로 위임. */
  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error(message, ...optionalParams);
  }

  /** warn 레벨로 위임. */
  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn(message, ...optionalParams);
  }

  /** debug 레벨로 위임. */
  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(message, ...optionalParams);
  }

  /** verbose는 log4js에 동일 레벨이 없어 trace로 위임한다. */
  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace(message, ...optionalParams);
  }
}

/**
 * `code-generation-stale` 카테고리(`logs/code-generation-stale.log` 전용 파일)의 log4js 로거를
 * 반환한다. 일반 NestJS `Logger`(→ `Log4jsLogger` → `app` 카테고리)를 거치지 않고 이 함수로
 * 직접 가져와야 별도 파일로 분리된다 — `CodeGenerationStaleMonitorService`처럼 운영자가 액션을
 * 취해야 하는 경고를 일반 애플리케이션 로그와 분리해 별도로 tail/알림 연동하고 싶은 경우에만
 * 쓴다(2026-07-23, 스케일아웃 점검 5번 후속). log4js 설정을 이 파일 하나로 모아두기 위해, 다른
 * 모듈이 `log4js`를 직접 import하지 않고 이 함수를 거치도록 한다.
 */
export function getCodeGenerationStaleLogger(): log4js.Logger {
  return log4js.getLogger('code-generation-stale');
}

/**
 * `s2s-failure` 카테고리(`logs/s2s-failure.log` 전용 파일)의 log4js 로거를 반환한다 —
 * `getCodeGenerationStaleLogger`와 동일한 이유/패턴. `CouponUsageService`가 reserve/confirm
 * 실패(result!==0)마다 `[company_code][project_code] [campaign_id]-요청파라미터-실패사유`
 * 형식으로 남길 때 쓴다(2026-07-27).
 */
export function getS2sFailureLogger(): log4js.Logger {
  return log4js.getLogger('s2s-failure');
}
