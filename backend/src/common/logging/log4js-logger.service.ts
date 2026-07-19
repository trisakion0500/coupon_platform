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
  },
  categories: {
    default: { appenders: ['console', 'file'], level: 'info' },
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
