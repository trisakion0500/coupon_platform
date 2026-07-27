import { config } from './config';
import { appLogger, shutdownLogger } from './logger';
import { startScheduler, stopScheduler } from './scheduler';
import { closeDbPool } from './testing/db/pool';

appLogger.info(
  `test_game_server 시작 — baseUrl=${config.couponServerBaseUrl} tickIntervalMs=${config.tickIntervalMs}`,
);
startScheduler();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  appLogger.info(`${signal} 수신 — 진행 중인 tick 마무리 후 종료`);
  await stopScheduler();
  await closeDbPool();
  await shutdownLogger();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
