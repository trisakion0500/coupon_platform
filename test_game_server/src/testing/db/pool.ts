import mysql from 'mysql2/promise';
import { config } from '../../config';

/**
 * coupon_platform 메인 DB용 커넥션 풀. `CALL SPTG_*(...)`만 호출한다(raw SELECT 없음,
 * docs/20_TEST_GAME_SERVER.md 2.2 "DB 콜은 SP로만" 원칙).
 */
export const dbPool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 5,
});

export async function closeDbPool(): Promise<void> {
  await dbPool.end();
}
