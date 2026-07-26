import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const BACKEND_DIR = join(__dirname, '..', '..');

/** `.env` 파일을 최소한으로 파싱한다(dotenv를 새 의존성으로 추가하지 않는다). 없으면 빈 객체. */
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2];
  }
  return env;
}

/**
 * E2E 전용 환경변수 병합 — `.env`를 기본값으로 깔고 `.env.test`(있으면)가 그 위를 덮어쓴다.
 * `.env.test`는 DB 접속 정보(`DB_*`/`LOG_DB_*`)만 담아 E2E를 별도 DB로 돌리기 위한 용도이고,
 * JWT_SECRET/ENCRYPTION_KEY 등 나머지는 항상 `.env`를 그대로 재사용한다 — `.env.test`가 없으면
 * 이전과 동일하게 `.env`만 쓰는 동작으로 자연히 되돌아간다(하위호환).
 *
 * @author trisakion
 */
export function loadE2eEnv(): Record<string, string> {
  const base = parseEnvFile(join(BACKEND_DIR, '.env'));
  const override = parseEnvFile(join(BACKEND_DIR, '.env.test'));
  return { ...base, ...override };
}

/**
 * 병합된 값을 `process.env`에 미리 심어둔다 — `@nestjs/config`의 `ConfigModule.forRoot()`가
 * 내부적으로 쓰는 dotenv는 이미 설정된 `process.env` 값을 덮어쓰지 않으므로, `AppModule`을
 * 컴파일하기 전에 이 함수를 호출해두면 `.env.test`의 값이 `.env`보다 우선 적용된다
 * (`test/utils/test-app.ts`가 `createE2eApp()` 맨 앞에서 호출한다).
 */
export function applyE2eEnvOverrides(): void {
  for (const [key, value] of Object.entries(loadE2eEnv())) {
    process.env[key] = value;
  }
}
