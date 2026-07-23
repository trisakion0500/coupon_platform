# 01_TECH_STACK.md

## Backend

| 항목            | 결정                                                       |
| --------------- | ---------------------------------------------------------- |
| Runtime         | Node.js 22 LTS                                              |
| Framework       | NestJS                                                      |
| Language        | TypeScript                                                  |
| Database        | MySQL 8.4                                                   |
| Data Access     | mysql2 — Stored Procedure / Function 전용 (Native SQL 직접 작성 금지) |
| Authentication  | JWT (HS256) + user_session (사용자 인증)                    |
| S2S Authentication | API Key + HMAC-SHA256 요청 서명 — 게임서버 → 쿠폰서버, Secret은 AES-256-CBC 가역 암호화 저장(단방향 해시 아님), Timestamp+Nonce로 재전송 방지, grace period 방식 재발급 |
| Password Hash   | bcrypt (rounds=12)                                          |
| API Style       | REST + JSON                                                 |
| Logging         | log_audit (감사 로그) + application log (log4js)            |
| S2S Call        | HTTP/HTTPS POST (JSON Payload)                              |

---

## Frontend

| 항목          | 결정                  |
| ------------- | --------------------- |
| Framework     | React 18 + TypeScript |
| Build         | Vite                  |
| UI 컴포넌트   | Ant Design (antd)     |
| 폼 상태 관리  | Ant Design Form (antd `Form`, 일부 컴포넌트는 react-hook-form) |
| 상태 관리     | Zustand               |
| HTTP          | Axios                 |

---

## 환경변수 관리 항목

모든 변수는 서버 기동 시점에 `backend/src/common/config/env.validation.ts`(Joi 스키마)로 검증한다 — 필수값이 없거나 형식이 틀리면 기동 자체가 실패한다(fail-fast). 아래 기본값은 그 스키마에 정의된 값과 동일하다.

### 서버 공통

| 변수      | 기본값        | 용도                                                                 |
| --------- | ------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`| `development` | 실행 환경 구분(`development`/`production`/`test`). 환경별 분기(로깅 verbosity 등)의 기준값 |
| `PORT`    | `3000`        | NestJS HTTP 서버 리스닝 포트                                            |

### 메인 서비스 DB (`coupon_platform`)

| 변수          | 기본값      | 용도 |
| ------------- | ----------- | ---- |
| `DB_HOST`     | `localhost` | 메인 DB 접속 호스트 |
| `DB_PORT`     | `3306`      | 메인 DB 접속 포트 |
| `DB_USER`     | (필수)      | 메인 DB 접속 계정 |
| `DB_PASSWORD` | (필수, 빈 문자열 허용) | 메인 DB 접속 비밀번호 |
| `DB_NAME`     | (필수)      | 메인 DB 스키마명 |
| `DB_CONNECTION_LIMIT` | `10` | 인스턴스(레플리카)당 mysql2 pool 크기. 총 DB 커넥션 = 레플리카 수 × (이 값 + `LOG_DB_CONNECTION_LIMIT`)이므로, 스케일아웃 시 레플리카 수에 맞춰 MySQL `max_connections` 한도를 넘지 않도록 조정(2026-07-23 하드코딩에서 이전) |

위 6개는 `SpExecutorService`(`backend/src/common/database/sp-executor.service.ts`)가 mysql2 커넥션 풀을 생성할 때 사용한다. company/project/user/coupon_* 등 메인 도메인 테이블 전부가 이 DB에 있다.

### 로그 전용 DB (`coupon_platform_log`)

| 변수              | 기본값      | 용도 |
| ----------------- | ----------- | ---- |
| `LOG_DB_HOST`     | `localhost` | 로그 DB 접속 호스트 |
| `LOG_DB_PORT`     | `3306`      | 로그 DB 접속 포트 |
| `LOG_DB_USER`     | (필수)      | 로그 DB 접속 계정 |
| `LOG_DB_PASSWORD` | (필수, 빈 문자열 허용) | 로그 DB 접속 비밀번호 |
| `LOG_DB_NAME`     | (필수)      | 로그 DB 스키마명 |
| `LOG_DB_CONNECTION_LIMIT` | `10` | 인스턴스(레플리카)당 mysql2 pool 크기(`DB_CONNECTION_LIMIT`과 동일 이유, 2026-07-23 하드코딩에서 이전) |

`log_audit`/`log_coupon_campaign`/`log_coupon_use` 3개 테이블 전용 — 메인 DB와 **물리적으로 분리**되어 있다(`02_DEV_CONVENTIONS.md` 1장). 접속 계정이 메인 DB와 같을 수도 다를 수도 있어 별도 변수로 관리한다. `LogSpExecutorService`(`backend/src/common/database/log-sp-executor.service.ts`)가 메인 DB와 완전히 분리된 별도 커넥션 풀로 사용 — 로그 적재 실패가 메인 트랜잭션에 영향을 주지 않는다는 원칙을 구조적으로 강제하기 위함이다.

### 사용자 인증 (JWT + Refresh Token)

| 변수                     | 기본값 | 용도 |
| ------------------------ | ------ | ---- |
| `JWT_SECRET`             | (필수, 32자 이상) | Access Token(JWT HS256) 서명/검증 키 |
| `JWT_ACCESS_EXPIRES_IN`  | `15m`  | Access Token 만료시간 |
| `JWT_REFRESH_EXPIRES_IN` | `7d`   | Refresh Token(opaque UUID) 만료시간 — 로그인 시 `user_session.expired_at`에 이 값만큼 더한 절대시각으로 저장해, 세션 정리 배치가 이 값 자체를 몰라도 `NOW()` 비교만으로 동작한다(`08_API_COMMON.md` 5.4) |

`07_AUTH_SECURITY.md` 1장 — Access Token은 stateless 검증(서명+만료), Refresh Token은 `user_session.refresh_token_hash`와 대조하는 stateful 검증이라 역할이 다르다. `09_AUTH_API.md` 6개 엔드포인트(회원가입/로그인/로그아웃/재발급/내정보/비번변경) 전부 구현 완료.

### 암호화 (AES-256-CBC)

| 변수             | 기본값 | 용도 |
| ---------------- | ------ | ---- |
| `ENCRYPTION_KEY` | (필수, 64자 hex = 32바이트) | `user.phone_number`와 `project.api_secret` 양쪽이 공유하는 AES-256-CBC 키. `CryptoService`(`backend/src/common/crypto/crypto.service.ts`)가 암/복호화에 사용한다. `npm run keygen`으로 생성 |

전용 키를 따로 두지 않고 두 용도(휴대폰번호/서버간 Secret)에 재사용하는 이유는 `07_AUTH_SECURITY.md` 2.1 참고 — 이미 있는 가역 암호화 인프라를 재사용하는 것이 별도 키 관리 비용을 늘릴 만큼 위협 모델이 다르지 않다고 판단했기 때문이다.

### S2S 인증 (HMAC-SHA256, 게임서버 → 쿠폰서버)

| 변수                          | 기본값           | 용도 |
| ----------------------------- | ---------------- | ---- |
| `API_SECRET_GRACE_PERIOD_DAYS`| `7`              | Secret 재발급 시 이전 Secret(`project.api_secret_prev`)을 함께 유효 처리하는 유예기간(일). 이 기간 동안은 신규/이전 Secret 둘 다로 서명해도 통과한다(`07_AUTH_SECURITY.md` 2.6) |
| `API_SECRET_CLEANUP_CRON`     | `0 5 * * *`      | 유예기간이 지난 `api_secret_prev`를 `NULL`로 정리하는 배치 주기(매일 새벽 5시) |
| `S2S_TIMESTAMP_TOLERANCE_SEC` | `300`            | `X-API-Timestamp` 허용 오차(초). 서버 시각 기준 과거/미래 양방향으로 이 범위를 벗어나면 거부(`07_AUTH_SECURITY.md` 2.4, result `10013`). `S2sAuthGuard`가 실제로 이 값을 읽어 검증한다 |
| `S2S_NONCE_CLEANUP_CRON`      | `*/10 * * * *`   | `project_api_nonce` 정리 배치 주기(10분 간격) — reserve/confirm 트래픽마다 1행씩 쌓여 다른 배치보다 훨씬 잦다(`07_AUTH_SECURITY.md` 2.5) |

`API_SECRET_CLEANUP_CRON`은 `ApiSecretCleanupService`가 실제로 `node-cron` 등록까지 마쳤다(project 도메인 구현 시점, `SP_PROJECT_API_SECRET_CLEANUP` 호출). `S2S_NONCE_CLEANUP_CRON`도 `NonceCleanupService`가 실제로 `node-cron` 등록까지 마쳤다(`SP_NONCE_CLEANUP` 호출, 스케일아웃 점검 4번, 2026-07-23 — 애초 설계 시점에 계획됐던 배치가 S2S 도메인 구현 때 누락된 채 남아있다가 뒤늦게 발견돼 추가됨). `S2S_TIMESTAMP_TOLERANCE_SEC`은 `S2sAuthGuard`에서 이미 실제로 소비 중이다. 위 3개 크론 배치(`SESSION_CLEANUP_CRON`/`API_SECRET_CLEANUP_CRON`/`S2S_NONCE_CLEANUP_CRON`) 전부 `SpExecutorService.runExclusive`로 감싸져 있어 스케일아웃 환경에서 레플리카 간 중복 실행되지 않는다(`02_DEV_CONVENTIONS.md` 4.1).

### CORS / 보안 헤더

| 변수                  | 기본값 | 용도 |
| --------------------- | ------ | ---- |
| `CORS_ALLOWED_ORIGINS`| (빈 문자열) | 콤마로 구분한 허용 오리진 목록(관리 콘솔 프론트엔드 도메인). 미등록 오리진의 요청은 차단한다(`08_API_COMMON.md` 5.1) |
| `SWAGGER_ENABLED`     | `false` | Swagger UI(`/docs`) 활성화 여부. 켜면 인라인 스크립트/스타일 때문에 CSP만 비활성화하고 나머지 보안 헤더(HSTS, X-Frame-Options 등)는 유지한다(`08_API_COMMON.md` 5.2) |

### 로깅 / 디버그

| 변수              | 기본값  | 용도 |
| ----------------- | ------- | ---- |
| `LOG_DEBUG_ERRORS`| `false` | 500 계열 오류 발생 시 서버 로그(log4js)에 스택트레이스까지 남길지 여부. **API 응답 바디에는 어떤 경우에도 노출되지 않는다** — 서버 로그 상세도만 제어(`HttpExceptionFilter` 참고) |

### Rate Limit / 정리 배치

| 변수                          | 기본값   | 용도 |
| ----------------------------- | -------- | ---- |
| `API_EXECUTION_TIMEOUT_MS`    | `30000`  | API 요청 처리 타임아웃(ms). 현재 값 검증까지만 구현, 실제 타임아웃 미들웨어는 미구현 |
| `LOGIN_RATE_LIMIT_WINDOW_MS`  | `900000` | 로그인/회원가입 API의 IP 기준 rate limit 윈도우(15분, `07_AUTH_SECURITY.md` 1.4). `AuthRateLimitMiddleware`가 실제로 이 값을 읽어 적용한다 |
| `LOGIN_RATE_LIMIT_MAX`        | `10`     | 위 윈도우 동안 허용하는 최대 요청 횟수. `AuthRateLimitMiddleware`가 실제로 소비 중 |
| `SESSION_CLEANUP_CRON`        | `0 4 * * *` | 만료된 `user_session` 행을 물리 삭제하는 배치 주기(매일 새벽 4시, `08_API_COMMON.md` 5.4). `SessionCleanupService`가 실제로 `node-cron` 등록까지 마쳤다 |

`API_EXECUTION_TIMEOUT_MS`만 아직 값 검증까지만 구현되어 있고, 실제 타임아웃 미들웨어는 없다 — 나머지 3개(`LOGIN_RATE_LIMIT_*`/`SESSION_CLEANUP_CRON`)는 `auth`/공통 인프라 도메인 구현 시점에 실제로 소비하도록 이미 반영됐다.

### 쿠폰 코드 생성 재시도

| 변수                                   | 기본값 | 용도 |
| -------------------------------------- | ------ | ---- |
| `CODE_GENERATION_MAX_DB_RETRIES`       | `5`    | RANDOM 코드 대량생성 백그라운드 루프에서 DB 일시 오류(커넥션 단절, 락 대기 타임아웃 등)가 발생했을 때 재시도할 최대 횟수. 소진되면 `generation_status=4`(실패)로 전이한다(`05_COUPON_ISSUANCE_SCENARIO.md` 2.2) |
| `CODE_GENERATION_RETRY_BASE_DELAY_MS`  | `200`  | 위 재시도의 exponential backoff 기준 지연(ms) — 시도마다 2배씩 늘어나고 여기에 jitter(0.5~1.0배)를 곱한다 |

코드값 충돌(nanoid 우연 중복, MySQL 1062)은 이 두 변수와 무관하게 지연 없이 무제한 즉시 재시도한다 — 단순 값 재추첨이라 DB 일시 오류와 성격이 다르기 때문(`05_COUPON_ISSUANCE_SCENARIO.md` 2.2 표 참고). `CampaignService`(`backend/src/campaign/campaign.service.ts`)의 `generateRandomCodes` 백그라운드 루프가 실제로 이 값들을 읽어 적용한다.

### 진행중 정체 캠페인 수동 복구(Abort) + 감지 모니터링

| 변수 | 기본값 | 용도 |
| ---- | ------ | ---- |
| `CODE_GENERATION_ABORT_STALE_SAFETY_MULTIPLIER` | `3` | `POST /campaigns/{id}/codes/abort`(`05_COUPON_ISSUANCE_SCENARIO.md` 2.4)가 "`coupon_campaign.updated_at`이 이만큼(초) 이상 안 움직였으면 멈춘 것으로 본다"고 판단하는 임계값의 안전 배율 |
| `CODE_GENERATION_STALE_MONITOR_CRON` | `*/5 * * * *` | 위와 동일한 정체 판정 임계값으로 `SP_CAMPAIGN_CODE_GENERATION_STALE_LIST`를 주기 조회해 서버 로그로 경고만 남기는 감지 전용 크론 주기(`CodeGenerationStaleMonitorService`, 스케일아웃 점검 5번, 2026-07-23) — 자동 복구는 하지 않는다 |

이 임계값은 별도로 독립된 값이 아니라 위 `CODE_GENERATION_MAX_DB_RETRIES`/`CODE_GENERATION_RETRY_BASE_DELAY_MS`에서 계산한다 — 정상적으로 살아있는 루프가 DB 일시 오류 재시도로 만들 수 있는 이론상 최대 무진행 구간(`baseDelay × (2^retries − 1)`)에 이 배율을 곱한 값을 임계값(초)으로 쓴다(`computeCodeGenerationStaleThresholdSec`, `backend/src/common/config/code-generation-stale-threshold.util.ts` — 원래 `CampaignService`에만 있던 계산을 `POST /codes/abort`와 감지 크론이 공유하도록 공용 유틸로 추출). 재시도 설정이 바뀌면 이 임계값도 자동으로 같이 늘어나므로, 세 설정을 별도로 맞춰줄 필요가 없다.
