# 19_DEV_SETUP.md

# 로컬 개발 환경 설정

---

# 1. 사전 요구사항

| 항목    | 버전   |
| ------- | ------ |
| Node.js | 22 LTS |
| MySQL   | 8.4    |
| Git     | 최신 버전 |

---

# 2. 저장소 클론

```bash
git clone https://github.com/trisakion0500/coupon_platform.git
cd coupon_platform
```

---

# 3. 데이터베이스 초기화

쿠폰 도메인 로그(`log_audit`/`log_coupon_campaign`/`log_coupon_use`)는 메인 서비스 DB와 물리적으로
분리된 별도 DB에 둔다(`02_DEV_CONVENTIONS.md` 1장). 그래서 메인 DB와 로그 DB를 각각 따로 만든다.

## 3.1 메인 DB 생성

```sql
CREATE DATABASE coupon_platform
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
```

## 3.2 메인 테이블 생성 및 초기 데이터

```bash
mysql -u root -p coupon_platform < database/tables/all_tables.sql
```

## 3.3 Function 생성

Procedure가 Function을 호출하는 경우가 있어(`SP_PROJECT_API_SECRET_ROTATE` → `FN_CHECK_PROJECT_ACCESS`)
Function을 먼저 만든다.

```bash
mysql -u root -p coupon_platform < database/functions/all_functions.sql
```

## 3.4 Stored Procedure 생성

```bash
mysql -u root -p coupon_platform < database/procedures/all_procedures.sql
```

실행 결과로 아래 초기 데이터가 삽입된다.

| 테이블  | ID  | code            | name                                   | 비고                                            |
| ------- | --- | --------------- | --------------------------------------- | ----------------------------------------------- |
| company | 1   | `ADMIN`         | Administrator Company                   | —                                                |
| company | 2   | `DEV`           | Developer Company                       | —                                                |
| project | 1   | `ADMIN_PROJECT` | Administrator Company Default Project   | company_id=1                                     |
| project | 2   | `DEV_PROJECT`   | Developer Company Default Project       | company_id=2                                     |
| user    | 1   | `sa`            | Super Admin                             | pw=`1234`, company=1, project=1, role=SUPER_ADMIN(10) |
| user    | 2   | `dev`           | Developer                               | pw=`1234`, company=2, project=2, role=DEVELOPER(20)   |
| user    | 3   | `mgr`           | Manager                                 | pw=`1234`, company=2, project=2, role=MANAGER(30)     |
| user    | 4   | `op`            | Operator                                | pw=`1234`, company=2, project=2, role=OPERATOR(40)    |

`project.api_secret` 시드값은 개발용 플레이스홀더라 실제 `ENCRYPTION_KEY`로 복호화되지 않는다 —
`POST /projects/{id}/api-secret/rotate`로 재발급받아야 실제 HMAC 서명 검증까지 테스트할 수 있다
(`project.sql` 헤더 주석 참고).

## 3.5 로그 DB 생성

```sql
CREATE DATABASE coupon_platform_log
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;
```

## 3.6 로그 테이블 생성

```bash
mysql -u root -p coupon_platform_log < database_log/tables/all_log_tables.sql
```

로그 테이블은 FK가 없고 초기 데이터도 없다 — 스키마만 생성하면 된다.

## 3.7 로그 DB용 Stored Procedure 생성

로그 DB 전용 SP(`SP_LOG_AUDIT_CREATE` 등)는 메인 DB SP와 저장 위치가 분리돼 있다(`02_DEV_CONVENTIONS.md` 3.1 — 메인 DB 산출물은 `database/`, 로그 DB 산출물은 `database_log/`).

```bash
mysql -u root -p coupon_platform_log < database_log/procedures/all_procedures_log.sql
```

---

# 4. 백엔드 설정

## 4.1 패키지 설치

```bash
cd backend
npm install
```

## 4.2 환경변수 설정

`backend/.env.example`을 복사해 `backend/.env`를 만들고 값을 채운다.

```bash
cp .env.example .env
```

```env
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=coupon_platform
DB_CONNECTION_LIMIT=10

LOG_DB_HOST=localhost
LOG_DB_PORT=3306
LOG_DB_USER=root
LOG_DB_PASSWORD=
LOG_DB_NAME=coupon_platform_log
LOG_DB_CONNECTION_LIMIT=10

JWT_SECRET=change-me-to-a-random-string-at-least-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

ENCRYPTION_KEY=00000000000000000000000000000000000000000000000000000000000000

API_SECRET_GRACE_PERIOD_DAYS=7
API_SECRET_CLEANUP_CRON=0 5 * * *

S2S_TIMESTAMP_TOLERANCE_SEC=300
S2S_NONCE_CLEANUP_CRON=*/10 * * * *

CORS_ALLOWED_ORIGINS=http://localhost:5173

LOG_DEBUG_ERRORS=true
SWAGGER_ENABLED=true

API_EXECUTION_TIMEOUT_MS=30000

LOGIN_RATE_LIMIT_WINDOW_MS=900000
LOGIN_RATE_LIMIT_MAX=10
SESSION_CLEANUP_CRON=0 4 * * *

COUPON_USAGE_RATE_LIMIT_BUCKET_CAPACITY=600
COUPON_USAGE_RATE_LIMIT_REFILL_PER_SEC=10

CODE_GENERATION_MAX_DB_RETRIES=5
CODE_GENERATION_RETRY_BASE_DELAY_MS=200
CODE_GENERATION_ABORT_STALE_SAFETY_MULTIPLIER=3
CODE_GENERATION_STALE_MONITOR_CRON=*/5 * * * *
```

`ENCRYPTION_KEY`는 `phone_number`/`project.api_secret`를 AES-256-CBC로 암호화하는 데 쓰는 32바이트
hex 키다. 아래 명령으로 생성한다.

```bash
npm run keygen
```

출력된 64자리 hex 문자열을 그대로 `ENCRYPTION_KEY`에 붙여넣는다. 이 키가 없거나 바뀌면 기존에
암호화된 값을 복호화할 수 없으므로, 팀원 간 공유 시 안전한 채널로 전달한다.

### 4.2.1 시드 계정 phone_number 정합성

`all_tables.sql`의 시드 데이터(`sa`/`dev`/`mgr`/`op`)는 개발용 플레이스홀더 `phone_number`를
포함한다(실제 `ENCRYPTION_KEY`로 암호화된 값이 아님, `user.sql` 헤더 주석 참고). `GET /auth/me` 등
복호화 경로를 로컬에서 테스트하려면 DB 초기화 직후 아래 명령으로 정리한다.

```bash
npm run fix-seed-phone
```

로컬 `.env`의 `ENCRYPTION_KEY`로 sa/dev/mgr/op의 `phone_number`를 실제 복호화 가능한 값
(`010-0000-0001`~`010-0000-0004`)으로 재암호화한다.

## 4.3 실행

```bash
npm run start:dev
```

서버 기동 확인: `http://localhost:3000/health`

`SWAGGER_ENABLED=true`이면 Swagger UI를 `http://localhost:3000/docs`에서 확인할 수 있다.

---

# 5. 코드 스타일

## 5.1 ESLint / Prettier

```bash
npm run lint
```

`eslint.config.mjs`(flat config)에 Prettier가 통합되어 있어 `npm run lint`(`--fix` 포함)로 포맷팅까지
한 번에 정리된다.

## 5.2 테스트

```bash
npm run test
```

---

# 6. 프론트엔드

구조 스캐폴딩 + 로그인/내 계정 화면까지 구현 완료(나머지 화면은 stub, `README.md` "현재 상태" 참고).

## 6.1 패키지 설치

```bash
cd frontend
npm install
```

## 6.2 환경변수 설정

`frontend/.env.example`을 복사해 `frontend/.env`를 만든다.

```bash
cp .env.example .env
```

```env
VITE_API_BASE_URL=http://localhost:3210
VITE_APP_NAME=Coupon Platform
```

`VITE_API_BASE_URL`은 백엔드 `.env`의 `PORT` 값과 일치해야 하고, 백엔드 `CORS_ALLOWED_ORIGINS`(`01_TECH_STACK.md` 참고)에 프론트엔드 오리진(`http://localhost:5173`, Vite 기본 포트)이 등록돼 있어야 API 호출이 CORS에 막히지 않는다.

## 6.3 실행

```bash
npm run dev
```

`http://localhost:5173`에서 확인한다. 백엔드가 먼저 떠 있어야 로그인 등 API 연동 화면이 정상 동작한다(4.3 참고). 시드 계정(`sa`/`dev`/`mgr`/`op`, pw `1234`)으로 로그인해 확인하되, `GET /auth/me` 조회가 필요한 화면(내 계정 등)을 테스트하려면 4.2.1(`npm run fix-seed-phone`)을 먼저 실행해야 한다 — 안 하면 `phone_number` 복호화 실패로 500이 난다.

---

# 7. 실행 확인

| 항목        | 확인 방법                                              |
| ----------- | ------------------------------------------------------- |
| DB 연결     | 서버 기동 로그에서 각 모듈 초기화 로그 확인(에러 없이 `Nest application successfully started`까지 출력) |
| 헬스체크    | `GET /health` → `{"result":0,"data":{"status":"ok"}}`   |
| 로그인      | `sa` 계정(pw `1234`)으로 `POST /auth/login`             |
| 내 정보 조회 | 로그인 응답의 `access_token`으로 `GET /auth/me` 호출(4.2.1 먼저 실행 필요) |
| SUPER_ADMIN | 위 토큰으로 `GET /companies` 호출 시 정상 응답(다른 role 토큰은 20001) |
