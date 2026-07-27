import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';
import mysql from 'mysql2/promise';
import { CryptoService } from '../common/crypto/crypto.service';

/** 시드 프로젝트별 평문 API Secret — 실제 서비스에 쓰이지 않는 개발용 더미값. */
const SEED_API_SECRETS: Record<string, string> = {
  ADMIN_PROJECT: 'dev-admin-project-api-secret-0001',
  DEV_PROJECT: 'dev-dev-project-api-secret-0002',
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
 * database/tables/project.sql의 api_secret 시드값은 user.sql의 phone_number(fix-seed-phone.ts
 * 참고)와 같은 이유로 개발용 플레이스홀더라 실제 ENCRYPTION_KEY로 복호화되지 않는다(ENCRYPTION_KEY가
 * 환경마다 달라 DDL에 특정 키로 암호화한 값을 고정 커밋할 수 없기 때문) — 그 상태로는 시드
 * 프로젝트(ADMIN_PROJECT/DEV_PROJECT)로 S2S 호출(reserve/confirm 등)의 서명 검증이 항상
 * "bad decrypt"로 실패한다. 이 스크립트는 로컬 `.env`의 ENCRYPTION_KEY로 두 프로젝트의
 * api_secret을 실제 복호화 가능한 값으로 갱신해, 매번 관리 콘솔로 새 프로젝트를 만들지 않고도
 * 시드 프로젝트로 바로 S2S 테스트(test_game_server 등)를 할 수 있게 한다. api_secret_prev는
 * 건드리지 않는다(이 갱신은 "재발급"이 아니라 "플레이스홀더 교정"이라 유예기간 로테이션과는
 * 무관함). `npm run fix-seed-secret`으로 실행한다(2026-07-27 추가).
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
    for (const [projectCode, apiSecret] of Object.entries(SEED_API_SECRETS)) {
      const encrypted = crypto.encrypt(apiSecret);
      const [rows] = await pool.query<mysql.RowDataPacket[]>(
        'SELECT `api_key` FROM `project` WHERE `project_code` = ?',
        [projectCode],
      );
      const apiKey = rows[0]?.api_key as string | undefined;

      const [result] = await pool.query(
        'UPDATE `project` SET `api_secret` = ? WHERE `project_code` = ?',
        [encrypted, projectCode],
      );
      const affectedRows = (result as mysql.ResultSetHeader).affectedRows;

      if (affectedRows > 0) {
        console.log(
          `${projectCode}: api_secret 갱신 완료 (api_key=${apiKey}, api_secret=${apiSecret})`,
        );
      } else {
        console.log(`${projectCode}: 해당 project_code를 찾지 못함(스킵)`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('fix-seed-secret 실패:', error);
  process.exit(1);
});
