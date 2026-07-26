import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import mysql from 'mysql2/promise';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { loadE2eEnv } from './env';

/** src/scripts/fix-seed-phone.ts와 동일한 더미값 — 시드 계정 phone_number를 실제 로컬
 * ENCRYPTION_KEY로 복호화 가능하게 다시 암호화하는 데 쓴다. */
const SEED_PHONE_NUMBERS: Record<string, string> = {
  sa: '010-0000-0001',
  dev: '010-0000-0002',
  mgr: '010-0000-0003',
  op: '010-0000-0004',
};

/** all_tables.sql의 FK 의존성 순서 반대(자식 먼저) — FK_CHECKS를 끄고 도니 순서 자체는 무관하지만
 * 안전하게 자식 테이블부터 비운다. */
const MAIN_TABLES_TRUNCATE_ORDER = [
  'coupon_code_usage',
  'coupon_code',
  'coupon_campaign',
  'user_session',
  'user_role',
  'user',
  'project_api_nonce',
  'project',
  'company',
];

const LOG_TABLES_TRUNCATE_ORDER = [
  'log_coupon_use',
  'log_coupon_campaign',
  'log_audit',
];

/**
 * `database/tables/all_tables.sql`에서 `INSERT INTO ...;` 블록만 그대로 뽑아온다 — 시드 데이터를
 * 이 스크립트에 다시 베껴 적으면 DDL이 바뀔 때마다 둘 다 고쳐야 하는 이격 위험이 생기므로,
 * 실제 DDL 파일을 유일한 소스로 재사용한다(company/project/user/user_role 4개 테이블만 시드가
 * 있음 — docs/19_DEV_SETUP.md 참고).
 */
function extractSeedInserts(ddlPath: string): string[] {
  const sql = readFileSync(ddlPath, 'utf8');
  return sql.match(/INSERT INTO `\w+`[\s\S]*?;/g) ?? [];
}

/**
 * E2E 테스트 전용 DB 리셋 — 기본은 별도 테스트 DB를 두지 않고 실제 로컬 개발 DB
 * (`coupon_platform`/`coupon_platform_log`)를 그대로 재사용하되(2026-07-24 "E2E는 개발 DB를
 * 리셋 가능한 것으로 취급한다" 결정), `.env.test`로 DB 접속 정보만 오버라이드해 완전히 분리된
 * 전용 테스트 DB를 쓸 수도 있다(2026-07-26, `loadE2eEnv` 참고 — `.env.test`가 없으면 이전과
 * 동일하게 `.env`만 쓴다). 매 실행마다 전 테이블을 TRUNCATE한 뒤 `all_tables.sql`의 시드
 * 데이터(company/project/user/user_role)만 다시 채운다. `npm run test:e2e`의 Jest globalSetup으로
 * 매번 자동 실행되고, `ts-node`로 단독 실행(`npm run test:e2e:reset`)도 가능하다.
 *
 * @author trisakion
 */
export async function resetDatabase(): Promise<void> {
  const env = loadE2eEnv();
  const configService = {
    getOrThrow: (key: string) => env[key],
  } as unknown as ConfigService;
  const crypto = new CryptoService(configService);

  const mainPool = mysql.createPool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  });
  const logPool = mysql.createPool({
    host: env.LOG_DB_HOST,
    port: Number(env.LOG_DB_PORT),
    user: env.LOG_DB_USER,
    password: env.LOG_DB_PASSWORD,
    database: env.LOG_DB_NAME,
  });

  try {
    await mainPool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of MAIN_TABLES_TRUNCATE_ORDER) {
      await mainPool.query(`TRUNCATE TABLE \`${table}\``);
    }
    await mainPool.query('SET FOREIGN_KEY_CHECKS = 1');

    const seedInserts = extractSeedInserts(
      join(__dirname, '..', '..', '..', 'database', 'tables', 'all_tables.sql'),
    );
    for (const insertSql of seedInserts) {
      await mainPool.query(insertSql);
    }

    // all_tables.sql의 phone_number 시드값은 project.api_secret과 마찬가지로 특정
    // ENCRYPTION_KEY로 고정 커밋할 수 없는 플레이스홀더라(fix-seed-phone.ts와 동일 이유), 리셋
    // 직후 실제 로컬 ENCRYPTION_KEY로 다시 암호화해야 GET /auth/me 등 복호화 경로가 500이 안 난다.
    for (const [loginId, phoneNumber] of Object.entries(SEED_PHONE_NUMBERS)) {
      const encrypted = crypto.encrypt(phoneNumber);
      await mainPool.query(
        'UPDATE `user` SET `phone_number` = ? WHERE `login_id` = ?',
        [encrypted, loginId],
      );
    }

    await logPool.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of LOG_TABLES_TRUNCATE_ORDER) {
      await logPool.query(`TRUNCATE TABLE \`${table}\``);
    }
    await logPool.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    await mainPool.end();
    await logPool.end();
  }
}

// ts-node로 단독 실행도 가능하게 CLI 엔트리를 겸한다(`npm run test:e2e:reset`, 수동 리셋용).
if (require.main === module) {
  resetDatabase()
    .then(() => console.log('E2E DB 리셋 완료'))
    .catch((error: unknown) => {
      console.error('E2E DB 리셋 실패:', error);
      process.exit(1);
    });
}
