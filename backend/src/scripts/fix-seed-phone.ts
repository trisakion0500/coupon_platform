import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import mysql from 'mysql2/promise';
import { CryptoService } from '../common/crypto/crypto.service';

/** 시드 계정별 평문 휴대폰번호 — 회사 로고나 실제 인물과 무관한 개발용 더미값. */
const SEED_PHONE_NUMBERS: Record<string, string> = {
  sa: '010-0000-0001',
  dev: '010-0000-0002',
  mgr: '010-0000-0003',
  op: '010-0000-0004',
};

/** `.env`를 최소한으로 파싱한다(dotenv를 새 의존성으로 추가하지 않기 위해 KEY=VALUE만 읽는다). */
function loadEnv(): Record<string, string> {
  const content = readFileSync(join(__dirname, '..', '..', '.env'), 'utf8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/**
 * database/tables/user.sql의 phone_number 시드값은 project.sql의 api_secret과 같은 개발용
 * 플레이스홀더라 실제 ENCRYPTION_KEY로 복호화되지 않는다(ENCRYPTION_KEY가 환경마다 달라 DDL에
 * 특정 키로 암호화한 값을 고정 커밋할 수 없기 때문). 이 스크립트는 로컬 `.env`의 ENCRYPTION_KEY로
 * sa/dev/mgr/op의 phone_number를 실제 복호화 가능한 값으로 갱신해, GET /auth/me 등 복호화 경로를
 * 로컬에서 테스트할 수 있게 한다. `npm run fix-seed-phone`으로 실행한다(2026-07-19 추가).
 *
 * @author trisakion
 */
async function main(): Promise<void> {
  const env = loadEnv();
  const configService = {
    getOrThrow: (key: string) => env[key],
  } as unknown as ConfigService;
  const crypto = new CryptoService(configService);

  const pool = mysql.createPool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  });

  try {
    for (const [loginId, phoneNumber] of Object.entries(SEED_PHONE_NUMBERS)) {
      const encrypted = crypto.encrypt(phoneNumber);
      const [result] = await pool.query(
        'UPDATE `user` SET `phone_number` = ? WHERE `login_id` = ?',
        [encrypted, loginId],
      );
      const affectedRows = (result as mysql.ResultSetHeader).affectedRows;
      console.log(
        affectedRows > 0
          ? `${loginId}: phone_number 갱신 완료`
          : `${loginId}: 해당 login_id를 찾지 못함(스킵)`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('fix-seed-phone 실패:', error);
  process.exit(1);
});
