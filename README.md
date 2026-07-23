# coupon_platform

여러 게임(프로젝트)이 가입해 쓰는 **멀티테넌트 쿠폰 발급/사용 플랫폼** 포트폴리오 프로젝트입니다.

게임서버가 쿠폰 발급/사용 검증을 위해 이 서버를 호출하고, 관리 콘솔(웹)로 회사/프로젝트/사용자/쿠폰을 운영하는 구조를 목표로 설계하고 있습니다.

## 주요 특징

- **멀티테넌시**: 회사(company) → 프로젝트(project) 단위로 데이터가 격리되며, 코드값 유니크 범위도 프로젝트 단위로 스코핑됩니다.
- **이중 인증 체계**: 관리 콘솔 사용자는 JWT(HS256) + 세션, 게임서버는 API Key + HMAC-SHA256 요청 서명(Secret은 AES-256-CBC 가역 암호화 저장, Timestamp+Nonce로 재전송 방지, 유예기간 로테이션) 기반 서버간(S2S) 인증을 사용합니다.
- **4단계 역할 체계**: SUPER_ADMIN / DEVELOPER / MANAGER / OPERATOR — 쿠폰 도메인 작업은 역할에 따라 즉시 반영되거나 승인 워크플로우를 거칩니다.
- **즉시 확정형 쿠폰 사용 흐름**: 인앱결제 consume/acknowledge 패턴을 참고해 reserve 시점에 즉시 소모를 확정하고, confirm은 결과 통보로만 동작하도록 설계해 분산 트랜잭션 이슈를 회피합니다.
- **동시성 안전성**: 코드 중복 소모, 캠페인 오버셀, 사용자별 한도 초과 등을 조건부 UPDATE와 갭락으로 방지합니다.
- **로그 도메인 분리**: 시스템관리자 / 플랫폼운영자 / 유저 영역별로 조회 권한이 다른 로그 테이블을 분리하고, 향후 별도 DB로 물리 분리되어도 메인 트랜잭션이 영향받지 않도록 설계했습니다.

## 기술 스택

- **Backend**: Node.js 22 LTS + NestJS + TypeScript
- **DB**: MySQL 8.4 + mysql2 (Stored Procedure/Function 전용)
- **Frontend**: React 18 + TypeScript + Vite + Ant Design + Zustand + Axios
- **인증**: JWT(HS256) / API Key + HMAC-SHA256 요청 서명(S2S)

세부 환경변수 및 버전은 [`docs/01_TECH_STACK.md`](docs/01_TECH_STACK.md) 참고.

## 디렉터리 구조

```
database/tables/   개별 테이블 DDL(.sql) + all_tables.sql 통합본
docs/               ERD, 스키마, API 명세, 화면/레이아웃 설계 문서
```

## 데이터베이스

기본 도메인(company/project/user/user_role/user_session), 쿠폰 도메인(coupon_campaign/coupon_code/coupon_code_usage), 로그(log_audit/log_coupon_campaign/log_coupon_use), 인증 인프라(project_api_nonce) 총 12개 테이블로 구성되어 있습니다.

- ERD: [`docs/03_ERD.md`](docs/03_ERD.md)
- 테이블별 상세 설계: [`docs/04_DATABASE_SCHEMA.md`](docs/04_DATABASE_SCHEMA.md)
- 캠페인/코드 발급 시나리오: [`docs/05_COUPON_ISSUANCE_SCENARIO.md`](docs/05_COUPON_ISSUANCE_SCENARIO.md)
- 쿠폰 사용(reserve/confirm) 시나리오: [`docs/06_COUPON_USAGE_SCENARIO.md`](docs/06_COUPON_USAGE_SCENARIO.md)

## 문서 목록

| 번호 | 문서 | 내용 |
| ---- | ---- | ---- |
| 01 | [TECH_STACK](docs/01_TECH_STACK.md) | 기술 스택, 환경변수 |
| 02 | [DEV_CONVENTIONS](docs/02_DEV_CONVENTIONS.md) | 로깅 원칙, 코드 모듈화 기준, SP 네이밍, 동시성 처리 컨벤션 |
| 03 | [ERD](docs/03_ERD.md) | 전체 테이블 ERD, 비정규화 FK, 상태코드 요약 |
| 04 | [DATABASE_SCHEMA](docs/04_DATABASE_SCHEMA.md) | 테이블별 특징/상태/특수규칙 |
| 05 | [COUPON_ISSUANCE_SCENARIO](docs/05_COUPON_ISSUANCE_SCENARIO.md) | 캠페인/코드 발급 흐름, 비동기 생성, 재시도 처리 |
| 06 | [COUPON_USAGE_SCENARIO](docs/06_COUPON_USAGE_SCENARIO.md) | 쿠폰 사용 흐름, 동시성 처리 |
| 07 | [AUTH_SECURITY](docs/07_AUTH_SECURITY.md) | 사용자 인증, S2S 인증 정책 |
| 08 | [API_COMMON](docs/08_API_COMMON.md) | 응답포맷/에러코드/페이지네이션 |
| 09 | [AUTH_API](docs/09_AUTH_API.md) | 회원가입/로그인/로그아웃 등 |
| 10 | [COMPANY_API](docs/10_COMPANY_API.md) | 회사 CRUD |
| 11 | [PROJECT_API](docs/11_PROJECT_API.md) | 프로젝트 CRUD, Secret 발급/재발급 |
| 12 | [USER_API](docs/12_USER_API.md) | 사용자 승인/반려/권한 배정 |
| 13 | [LOG_AUDIT_API](docs/13_LOG_AUDIT_API.md) | 감사로그 조회 |
| 14 | [MENU_PERMISSION](docs/14_MENU_PERMISSION.md) | 역할별 메뉴 접근 권한 |
| 15 | [SCREEN_LIST](docs/15_SCREEN_LIST.md) | 화면 목록 및 연관 API |
| 16 | [LAYOUT](docs/16_LAYOUT.md) | 레이아웃, 라우트, 공통 컴포넌트 |
| 17 | [CAMPAIGN_API](docs/17_CAMPAIGN_API.md) | 캠페인 CRUD, 상태변경, 승인/반려, 코드 발급(RANDOM 비동기/FIXED 동기) |
| 18 | [COUPON_USAGE_API](docs/18_COUPON_USAGE_API.md) | 쿠폰 사용 reserve/confirm, 미컨슘 조회 |
| 19 | [DEV_SETUP](docs/19_DEV_SETUP.md) | 로컬 개발 환경 설정 |

## 현재 진행 상황

DB 설계(테이블 12개)와 관련 문서(01~19)가 모두 완료된 상태입니다. 백엔드 공통 인프라(`backend/`, NestJS + mysql2 SP 실행기 + 공통 응답 포맷 + S2S HMAC 인증 가드 + 헬스체크 + 역할 기반 권한 가드)에 이어 `auth`(회원가입/로그인/세션)·`company`·`project`(CRUD/Secret 발급·재발급)·`user`/`user_role`(승인/반려/권한배정) 도메인과 감사로그(`log_audit`, 적재 + 조회 API `GET /log-audits`) 구현을 마쳤습니다.

쿠폰 도메인은 4단계로 나눠 진행했고 전 단계 구현이 완료됐습니다 — 1단계(캠페인 CRUD + 승인 워크플로우, `edit_count` 낙관적 동시성 제어), 2단계(코드 발급 — RANDOM 비동기 대량생성/재시도, FIXED 동기 등록, 진행중 정체 시 수동 복구(`abort`), 캠페인 종료 시 생성 루프 중단 등 동시성 방어), 3단계(캠페인별 쿠폰 사용 이력 조회), 4단계(쿠폰 사용 reserve/confirm + 미컨슘 조회 + `log_coupon_use` 적재). 이어서 캠페인 변경 이력(`GET /campaigns/{id}/logs`)·쿠폰 사용 로그(`GET /coupon-use-logs`) 조회 API까지 구현을 마쳤습니다(`docs/17_CAMPAIGN_API.md` 4.2/4.3).

쿠폰 도메인 구현 완료 직후 스케일아웃(수평 확장) 대응 점검을 진행해 5개 항목을 모두 해결했습니다 — graceful shutdown 훅(SIGTERM 시 DB 커넥션 풀 안전 종료), DB 커넥션 풀 크기 env화(`DB_CONNECTION_LIMIT`/`LOG_DB_CONNECTION_LIMIT`), 크론 배치 인스턴스 간 중복 실행 방지(`SpExecutorService.runExclusive`, GET_LOCK 기반), `project_api_nonce` 정리 배치 신규 구현(`SP_NONCE_CLEANUP`), 정체된 코드생성 job 감지 모니터링(자동 복구는 하지 않고 경고 로그만). 곁들여 로그 파일을 일별 로테이션(`dateFile`) + ERROR 전용 파일로 분리하고, S2S 쿠폰 사용 로그(`log_coupon_use`)에 `caller_ip`를 추가했습니다. 전역 API 실행 타임아웃(`TimeoutInterceptor`, `API_EXECUTION_TIMEOUT_MS` 초과 시 408)과 reserve/confirm 프로젝트(API Key) 단위 rate limiter(`CouponUsageRateLimitMiddleware`, `07_AUTH_SECURITY.md` 2.8)도 이어서 구현했습니다. 로컬 개발 환경 설정은 `docs/19_DEV_SETUP.md` 참고. 프론트엔드 구현은 아직 시작 전입니다.

### 향후 개선사항 (우선순위 낮음, 별도 검토 필요)

- 쿠폰 사용(reserve/confirm) API의 **유저 단위(오남용 방지) rate limit** — 프로젝트 단위(인프라 보호)는 구현 완료(위 문단 참고), 특정 유저의 반복 어뷰징까지 잡는 이중 적용은 **알려진 TODO로 보류 중**. 프로젝트 단위와 달리 유저 단위는 스케일아웃 환경에서 인스턴스별 in-memory 카운터로는 실효 한도가 인스턴스 수배로 늘어나는 문제가 더 크게 체감된다(유저 수가 프로젝트 수보다 훨씬 많아 카운터 자체도 무겁고, 어뷰징 방지 목적상 정확한 합산 카운트가 중요) — 지금 인프라(Redis 없음)로 어설프게 구현하기보다, 아래 Redis 도입과 함께 정확한 분산 카운터로 구현하는 쪽이 낫다고 판단해 명시적으로 뒤로 미뤄둠.
- **Redis 도입 시 함께 이관할 대상**(총 3개):
  1. 유저 단위 rate limit 카운터 — 위 항목, Redis 도입 시점에 맞춰 신규 구현
  2. `project_api_nonce` — S2S nonce 재전송 방지용, Redis로 가면 TTL 자연만료라 정리 배치(`S2S_NONCE_CLEANUP_CRON`) 자체가 불필요해짐
  3. `user_session` — Redis로 가면 TTL 자연만료라 `SESSION_CLEANUP_CRON` 불필요해짐 — `user_session.user_id`에 FK를 안 건 것도 애초에 이 전환을 대비한 설계(`04_DATABASE_SCHEMA.md` 참고)

  프로젝트 단위 rate limiter(`CouponUsageRateLimitMiddleware`)는 in-memory로 유지하기로 확정된 설계라 이관 대상 아님.
