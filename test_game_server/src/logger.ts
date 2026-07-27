import * as log4js from 'log4js';

/**
 * backend의 `common/logging/log4js-logger.service.ts`와 동일한 감각(콘솔 + 날짜별 회전 파일,
 * 카테고리로 관심사 분리)의 독립 log4js 설정이다 — 이 프로젝트는 NestJS가 아니므로 어댑터 없이
 * `log4js.getLogger()`를 직접 쓴다(docs/20_TEST_GAME_SERVER.md 7장).
 *
 * `mismatch` 카테고리는 backend의 `code-generation-stale` 카테고리와 동일한 선례 — 이 도구의
 * 핵심 산출물(기대와 다른 결과)을 일반 로그 더미에 묻히지 않게 별도 파일로 분리한다.
 */
log4js.configure({
  appenders: {
    console: { type: 'console' },
    file: {
      type: 'dateFile',
      filename: 'logs/app.log',
      pattern: 'yyyy-MM-dd',
      keepFileExt: true,
    },
    mismatchFile: {
      type: 'dateFile',
      filename: 'logs/mismatch.log',
      pattern: 'yyyy-MM-dd',
      keepFileExt: true,
    },
  },
  categories: {
    default: { appenders: ['console', 'file'], level: 'info' },
    mismatch: { appenders: ['console', 'mismatchFile'], level: 'warn' },
  },
});

export const appLogger = log4js.getLogger('app');
export const mismatchLogger = log4js.getLogger('mismatch');

/** SIGINT/SIGTERM 종료 시 파일 버퍼를 플러시하고 log4js를 정리한다. */
export function shutdownLogger(): Promise<void> {
  return new Promise((resolve) => log4js.shutdown(() => resolve()));
}
