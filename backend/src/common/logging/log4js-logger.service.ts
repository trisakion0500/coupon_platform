import { LoggerService } from '@nestjs/common';
import * as log4js from 'log4js';

log4js.configure({
  appenders: {
    console: { type: 'console' },
    // 크기 기반(maxLogSize/backups)이 아니라 날짜 기반(dateFile)으로 매일 자정 새 파일로
    // 넘어간다(2026-07-23) — 파일 하나가 무한정 쌓이던 문제를 해결하고, 날짜별로 파일이 나뉘어
    // 있어야 "어제/특정 날짜 로그만" 찾기도 쉽다. alwaysIncludePattern을 기본값(false)으로 둬서
    // 오늘 로그는 그냥 `app.log`이고, 자정에 회전되는 순간 지난 로그만 `app.2026-07-23.log`처럼
    // keepFileExt로 날짜가 확장자 앞에 붙는 이름으로 바뀐다(`app.log.2026-07-23`가 아니라) —
    // "지금 쓰고 있는 파일"과 "지난 날짜 파일"을 이름만으로 구분하려는 의도.
    file: {
      type: 'dateFile',
      filename: 'logs/app.log',
      pattern: 'yyyy-MM-dd',
      keepFileExt: true,
    },
    // ERROR 레벨만 걸러 별도 파일로도 남긴다(2026-07-23) — app.log는 info 이상 전부 섞여 있어
    // 장애 조사 시 에러만 빠르게 훑어보기 어렵다. errorFile 자체에 바로 로그를 쓰지 않고
    // logLevelFilter로 감싸는 이유는 이 필터가 하는 일이 "받은 이벤트 중 error 이상만
    // errorFile로 통과시키는 것"이기 때문 — default 카테고리는 여전히 file(app.log)에도 그대로
    // 쓰므로 error.log는 복제본이지 대체가 아니다(app.log만 봐도 시간순 전체 맥락은 유지됨).
    errorFile: {
      type: 'dateFile',
      filename: 'logs/error.log',
      pattern: 'yyyy-MM-dd',
      keepFileExt: true,
    },
    errorOnly: {
      type: 'logLevelFilter',
      appender: 'errorFile',
      level: 'error',
    },
    // 정체 코드생성 job 감지 경고(CodeGenerationStaleMonitorService) 전용 — 일반 app.log에
    // 묻히면 운영자가 놓치기 쉬운 액션 필요 경고라 별도 파일로 분리한다(2026-07-23, 스케일아웃
    // 점검 5번 후속). 운영 환경에서 이 파일만 별도로 tail/알림 연동하기 위함.
    codeGenerationStaleFile: {
      type: 'dateFile',
      filename: 'logs/code-generation-stale.log',
      pattern: 'yyyy-MM-dd',
      keepFileExt: true,
    },
    // S2S(게임서버->쿠폰서버) 사용 API가 실패(result!==0)할 때마다 남기는 운영 전용 로그
    // (2026-07-27) - 일반 app.log에 성공 로그와 섞이면 실패만 훑어보기 어려워 code-generation-stale과
    // 동일한 이유로 분리한다. CouponUsageService에서만 쓴다.
    s2sFailureFile: {
      type: 'dateFile',
      filename: 'logs/s2s-failure.log',
      pattern: 'yyyy-MM-dd',
      keepFileExt: true,
    },
  },
  categories: {
    default: { appenders: ['console', 'file', 'errorOnly'], level: 'info' },
    'code-generation-stale': {
      appenders: ['console', 'codeGenerationStaleFile'],
      level: 'warn',
    },
    's2s-failure': { appenders: ['console', 's2sFailureFile'], level: 'warn' },
  },
});

/**
 * 01_TECH_STACK.md의 application log(log4js) 정책 — NestJS LoggerService를 log4js로 위임한다.
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
