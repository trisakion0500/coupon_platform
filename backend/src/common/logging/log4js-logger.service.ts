import { LoggerService } from '@nestjs/common';
import * as log4js from 'log4js';

log4js.configure({
  appenders: {
    console: { type: 'console' },
    file: {
      type: 'file',
      filename: 'logs/app.log',
      maxLogSize: 10 * 1024 * 1024,
      backups: 5,
    },
    // 정체 코드생성 job 감지 경고(CodeGenerationStaleMonitorService) 전용 — 일반 app.log에
    // 묻히면 운영자가 놓치기 쉬운 액션 필요 경고라 별도 파일로 분리한다(2026-07-23, 스케일아웃
    // 점검 5번 후속). 운영 환경에서 이 파일만 별도로 tail/알림 연동하기 위함.
    codeGenerationStaleFile: {
      type: 'file',
      filename: 'logs/code-generation-stale.log',
      maxLogSize: 10 * 1024 * 1024,
      backups: 5,
    },
  },
  categories: {
    default: { appenders: ['console', 'file'], level: 'info' },
    'code-generation-stale': {
      appenders: ['console', 'codeGenerationStaleFile'],
      level: 'warn',
    },
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
