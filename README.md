# coupon_platform

> 여러 게임이 하나의 플랫폼을 공유해 쓰는 멀티테넌트 쿠폰 발급/사용 서버

📄 **[포트폴리오 PDF로 한눈에 보기](docs/pdf-export/COUPON_PLATFORM_GUIDE_PORTFOLIO.pdf)** — 이 프로젝트 소개 + 입점사 연동 가이드를 한 파일로 정리한 버전

---

## 왜 만들었나

게임마다 이벤트 쿠폰(신규가입 보상, 프로모션 코드 등)을 발급하고 검증하는 기능이 필요하다. 문제는 이 기능을 게임마다 각자 구현하면 같은 실수가 반복된다는 점이다.

- 같은 쿠폰 코드가 동시에 두 번 소모되는 레이스 컨디션
- 한정 수량 쿠폰이 목표 수량을 넘겨 발급/소모되는 오버셀
- 게임서버↔쿠폰서버 간 통신을 가로채 재전송하는 리플레이 공격
- 여러 게임(테넌트)이 뒤섞여 서로의 쿠폰 코드/사용 이력을 침범하는 데이터 격리 실패

**coupon_platform은 이 문제를 여러 게임이 공유하는 하나의 플랫폼으로 풀기 위해 설계했다.** 게임서버는 쿠폰 발급/사용 시점에 이 서버를 호출하기만 하면 되고, 동시성·보안·테넌트 격리는 플랫폼이 구조적으로 보장한다.

---

## 핵심 아이디어

쿠폰 사용은 게임서버가 "이 코드 쓸게" → "지급 결과 알려줄게" 두 단계로 호출하는 게 자연스럽다. 하지만 이 두 호출 사이에 게임서버가 죽거나 응답을 놓치면 어떻게 될까?

coupon_platform은 인앱결제의 consume/acknowledge 패턴을 참고해 **reserve 시점에 소모를 즉시 확정**하고, 뒤이은 confirm은 지급 결과를 통보받는 용도로만 쓰도록 설계했다. 분산 트랜잭션 없이도 재시도가 항상 안전하다 — reserve를 두 번 호출해도(멱등), confirm을 영원히 안 불러도(코드는 이미 소모 완료 처리) 데이터가 어긋나지 않는다.

이 모델을 실제로 안전하게 만드는 건 결국 동시성 처리다:

- 코드 중복 소모/캠페인 오버셀 → 조건부 UPDATE + 갭락
- 관리 콘솔의 동시 수정 충돌 → `edit_count` 낙관적 동시성 제어
- 게임서버 인증 재전송 → API Key + HMAC-SHA256 서명 + Timestamp/Nonce, Secret은 유예기간을 둔 로테이션

---

## 멀티테넌트 운영 구조

회사(company) → 프로젝트(project) → 쿠폰 도메인(캠페인/코드/사용이력) 계층으로 데이터 모델을 설계했다. 코드값 유니크 범위도 전역이 아니라 프로젝트 단위로 스코핑되어, 서로 다른 게임의 쿠폰 코드가 우연히 겹쳐도 문제가 없다.

역할은 4단계 누적 구조(`SUPER_ADMIN ⊇ DEVELOPER ⊇ MANAGER ⊇ OPERATOR`)로, 쿠폰 도메인 작업은 프로젝트에 실제로 배정된 역할 기준으로 스코핑된다 — 같은 회사 소속이어도 배정되지 않은 프로젝트의 쿠폰은 건드릴 수 없다.

---

## 기술 스택

**Backend**

| 항목        | 스택                                    |
| ----------- | ---------------------------------------- |
| Runtime     | Node.js 22 LTS                           |
| Framework   | NestJS + TypeScript                      |
| Database    | MySQL 8.4                                |
| Data Access | mysql2 (Stored Procedure/Function 전용)  |
| 캐시/S2S 재전송 방지 | Redis(ioredis, 선택 — `REDIS_ENABLED`, 장애 시 DB로 fail-open) |
| 인증        | JWT(HS256) + user_session                |
| S2S 인증    | API Key + HMAC-SHA256 요청 서명          |
| 비밀번호    | bcrypt (rounds=12)                       |
| 로깅        | log_audit / log_coupon_campaign / log_coupon_use + application log(log4js) |

> **왜 SP/Function 전용으로 강제했는가**
> 정합성이 중요한 도메인(코드 중복소모 방지, 캠페인 오버셀 방지, 낙관적 동시성 제어)일수록 애플리케이션 레이어의 트랜잭션 코드보다 DB 제약·락으로 강제하는 편이 실수할 여지가 적다. ORM이나 Native SQL 직접 작성을 금지하고 모든 쓰기를 Stored Procedure로 강제한 이유다 — `docs/04_DEV_CONVENTIONS.md` 참고.

**Frontend**

| 항목      | 스택                  |
| --------- | --------------------- |
| Framework | React 18 + TypeScript |
| Build     | Vite                  |
| UI        | Ant Design            |
| 폼        | Ant Design Form       |
| 상태 관리 | Zustand               |
| HTTP      | Axios                 |
| 다국어    | react-i18next(ko/en)  |

세부 환경변수 및 버전은 [`docs/02_TECH_STACK.md`](docs/02_TECH_STACK.md) 참고.

---

## 주요 기능

- **회사 / 프로젝트 관리** — 멀티테넌트 데이터 격리, 프로젝트 단위 API Key/Secret 발급
- **사용자 관리** — 가입 승인 워크플로우 / 역할 기반 권한(SUPER_ADMIN/DEVELOPER/MANAGER/OPERATOR)
- **캠페인/쿠폰 코드 관리** — 캠페인 CRUD, RANDOM 코드 비동기 대량생성(재시도/정체 복구), FIXED 코드 동기 등록
- **쿠폰 사용(S2S)** — reserve(즉시확정) / confirm(결과통보), 미컨슘 조회
- **감사 로그** — 시스템관리자(`log_audit`) / 플랫폼운영자(`log_coupon_campaign`) / 유저(`log_coupon_use`) 영역별 로그 분리

> **즉시 반영 vs 승인 워크플로우 기준**
> 쿠폰 도메인 작업(캠페인 등록/수정, 코드 발급)은 요청자 역할에 따라 처리 방식이 갈린다. `MANAGER` 이상은 즉시 반영되고, `OPERATOR`가 등록/수정하면 승인요청 상태로 전환되어 `MANAGER` 이상의 승인을 거쳐야 한다. 운영 실수(과다 발급, 잘못된 보상 설정 등)를 하위 권한자의 작업에 한해 한 번 더 걸러내기 위한 구조다.

---

## 문서 목록

| 문서 | 내용 |
| ---- | ---- |
| [01_COUPON_PLATFORM_GUIDE.md](docs/01_COUPON_PLATFORM_GUIDE.md) | 입점 게임사 담당자용 이용/연동 가이드(콘솔 사용법 + S2S 연동) |
| [02_TECH_STACK.md](docs/02_TECH_STACK.md) | 기술 스택, 환경변수 |
| [03_DEV_SETUP.md](docs/03_DEV_SETUP.md) | 로컬 개발 환경 설정 |
| [04_DEV_CONVENTIONS.md](docs/04_DEV_CONVENTIONS.md) | 로깅 원칙, 코드 모듈화 기준, SP 네이밍, 동시성 처리 컨벤션 |
| [05_ERD.md](docs/05_ERD.md) | 전체 테이블 ERD, 비정규화 FK, 상태코드 요약 |
| [06_DATABASE_SCHEMA.md](docs/06_DATABASE_SCHEMA.md) | 테이블별 특징/상태/특수규칙 |
| [07_COUPON_ISSUANCE_SCENARIO.md](docs/07_COUPON_ISSUANCE_SCENARIO.md) | 캠페인/코드 발급 흐름, 비동기 생성, 재시도 처리 |
| [08_COUPON_USAGE_SCENARIO.md](docs/08_COUPON_USAGE_SCENARIO.md) | 쿠폰 사용 흐름, 동시성 처리 |
| [09_AUTH_SECURITY.md](docs/09_AUTH_SECURITY.md) | 사용자 인증, S2S 인증 정책 |
| [10_API_COMMON.md](docs/10_API_COMMON.md) | 응답포맷/에러코드/페이지네이션 |
| [11_AUTH_API.md](docs/11_AUTH_API.md) | 회원가입/로그인/로그아웃 등 |
| [12_COMPANY_API.md](docs/12_COMPANY_API.md) | 회사 CRUD |
| [13_PROJECT_API.md](docs/13_PROJECT_API.md) | 프로젝트 CRUD, Secret 발급/재발급 |
| [14_USER_API.md](docs/14_USER_API.md) | 사용자 승인/반려/권한 배정 |
| [15_LOG_AUDIT_API.md](docs/15_LOG_AUDIT_API.md) | 감사로그 조회 |
| [16_MENU_PERMISSION.md](docs/16_MENU_PERMISSION.md) | 역할별 메뉴 접근 권한 |
| [17_SCREEN_LIST.md](docs/17_SCREEN_LIST.md) | 화면 목록 및 연관 API |
| [18_LAYOUT.md](docs/18_LAYOUT.md) | 레이아웃, 라우트, 공통 컴포넌트 |
| [19_CAMPAIGN_API.md](docs/19_CAMPAIGN_API.md) | 캠페인 CRUD, 상태변경, 승인/반려, 코드 발급(RANDOM 비동기/FIXED 동기) |
| [20_COUPON_USAGE_API.md](docs/20_COUPON_USAGE_API.md) | 쿠폰 사용 reserve/confirm, 미컨슘 조회 |
| [21_TEST_GAME_SERVER.md](docs/21_TEST_GAME_SERVER.md) | S2S 연동 검증용 독립 테스트 클라이언트(test_game_server) 설계 |

> 위 문서 중 프로젝트 소개(본 README)+`01_COUPON_PLATFORM_GUIDE.md`를 합친 PDF는 [COUPON_PLATFORM_GUIDE_PORTFOLIO.pdf](docs/pdf-export/COUPON_PLATFORM_GUIDE_PORTFOLIO.pdf)에서 볼 수 있습니다.

---

## 프로젝트 구조

```
coupon_platform/
├── backend/            # Backend (NestJS)
├── frontend/           # Frontend (React)
├── database/
│   ├── tables/         # 메인 DB DDL(.sql, all_tables.sql 포함)
│   ├── procedures/     # 메인 DB Stored Procedure
│   └── functions/      # 메인 DB Function
├── database_log/
│   ├── tables/         # 로그 DB DDL(메인 DB와 물리 분리)
│   └── procedures/     # 로그 DB 전용 Stored Procedure
├── test_game_server/   # S2S 연동 검증용 독립 테스트 클라이언트(backend/frontend와 완전 분리)
└── docs/                # 설계 문서
```

---

## AI 활용

이 프로젝트는 AI를 개발 보조 도구로 활용한 워크플로우를 실험하기 위해 진행되었다.

설계 결정, 트레이드오프 판단, 실서버 라이브 검증은 개발자가 직접 수행하였으며, AI(Claude Code)는 문서/코드 초안 작성과 반복적인 구현 작업의 속도를 높이는 데 활용하였다. 예를 들어 낙관적 동시성 제어를 `updated_at` 비교에서 `edit_count` 전용 컬럼으로 바꾼 결정, S2S rate limiter를 고정 윈도우에서 토큰 버킷으로 교체한 결정은 모두 개발자가 먼저 문제를 지적하고 방향을 제시한 뒤 구현했다.

| 도구        | 용도                                  |
| ----------- | -------------------------------------- |
| Claude Code | 문서/코드 초안 작성, 리팩터링, 실서버 스모크 테스트 보조 |

---

## 현재 상태

- ✅ 데이터베이스 설계 완료 (테이블 12개)
- ✅ API 명세 작성 완료 (`docs/01~21`)
- ✅ 역할별 권한 설계 완료 (SUPER_ADMIN/DEVELOPER/MANAGER/OPERATOR)
- ✅ 화면 목록 작성 완료
- ✅ 레이아웃 구조 정의 완료
- ✅ 로컬 개발 환경 설정 완료
- ✅ Backend 구현 완료
  - ✅ 공통 인프라 — NestJS + mysql2 SP 실행기 + 공통 응답 포맷 + S2S HMAC 인증 가드 + 헬스체크 + 역할 기반 권한 가드
  - ✅ Auth API — 회원가입 / 로그인 / 로그아웃 / 토큰 재발급 / 내 정보 조회 / 비밀번호 변경
  - ✅ Company API — CRUD + 코드조회(lookup, 회원가입 화면 전용 인증 불필요) + 헤더 선택용(active-header-data)
  - ✅ Project API — CRUD + API Secret 발급/재발급 + 코드조회(lookup) + 헤더 선택용(내 role 조회, `user-roles/me`)
  - ✅ User / User Role API — 목록 / 상세 / 가입 승인·반려 / 수정 / 비밀번호 강제 초기화 / 권한 배정
  - ✅ Audit Log API(`log_audit`) — 5개 도메인 감사 이력 적재 + 목록/상세 조회
  - ✅ Campaign API — CRUD / 상태변경 / 승인·반려(`edit_count` 낙관적 동시성 제어)
  - ✅ Coupon Code Issuance API — RANDOM 비동기 대량생성+재시도, FIXED 동기 등록, 진행중 정체 시 수동 복구(`abort`)
  - ✅ Coupon Usage History / Campaign Change Log / Coupon Use Log 조회 API
  - ✅ Coupon Usage API(S2S) — reserve / confirm(즉시확정 모델) / 미컨슘 조회 + `log_coupon_use` 적재
  - ✅ 스케일아웃(수평 확장) 대응 — graceful shutdown, DB 커넥션 풀 크기 env화, 크론 배치 중복실행 방지(`runExclusive`), nonce 정리 배치, 정체 코드생성 감지 모니터링
  - ✅ Redis 도입 1단계 — 공용 `RedisModule`(ioredis, `REDIS_ENABLED`) + S2S nonce 재전송 방지의 1차 경로(Redis 장애 시 기존 DB 경로로 fail-open 폴백)
  - ✅ Redis 도입 2단계 — JWT 세션 검증(jti) 읽기 캐시(`SessionCacheService`, DB가 항상 source of truth). 로그아웃/비밀번호변경/계정정지 시 유저 단위 generation 카운터로 일괄 무효화, `refresh()`는 이전 jti만 정밀 삭제. 동시성 감사로 발견한 "DB 검증 성공~캐시 write 사이" 레이스는 write 직후 재확인으로 완화(완전 폐쇄는 구조적으로 불가능 — `09_AUTH_SECURITY.md` 1.3.1)
  - ✅ Redis 도입 3단계 — reserve/confirm **유저(game_user_id) 단위** rate limit(`SlidingWindowCounterLimiter`). 프로젝트 단위(in-memory 토큰버킷)와 별개 레이어, 알고리즘은 고정윈도우/토큰버킷(Lua 필요)/슬라이딩윈도우로그(메모리 부담) 대비 슬라이딩 윈도우 카운터로 확정(`09_AUTH_SECURITY.md` 2.8.2). `REDIS_ENABLED=false`면 대체 경로 없이 완전히 스킵(1·2단계와 다른 성격). 이걸로 Redis 도입 대상 3개 전부 완료 — 남은 TODO(카운터 초과 알람, 회사 단위 리미터)는 아래 "향후 개선사항" 참고
  - ✅ 사용기간 만료 캠페인 자동 종료 — 활성+승인완료(또는 승인불요) 상태에서 `campaign_end`가 지나면 배치가 `status=4`(종료)로 전환(`CampaignExpiryService`, 종료 후엔 예외 없이 모든 수정 차단)
  - ✅ 운영 보완 — 로그 파일 일별 로테이션 + ERROR 전용 분리, 클러스터(다중 인스턴스) 구동 대비 로그 파일명 인스턴스 suffix(`INSTANCE_ID`/`NODE_APP_INSTANCE`), S2S 호출자 IP 기록, 전역 API 실행 타임아웃, reserve/confirm 프로젝트 단위 rate limiter(토큰 버킷)
  - ✅ Swagger 문서화 — `nest-cli.json`에 swagger CLI 플러그인(`classValidatorShim`) 등록 + 전체 요청 DTO(32개)에 `@ApiProperty()`/`@ApiPropertyOptional()`(설명/예시 포함) 추가. 응답 스키마도 문서화 완료 — 응답 타입(순수 TS interface)을 데코레이터 붙은 클래스로 옮기고, `{result, data}` 응답 봉투까지 그대로 반영하는 공용 데코레이터(`ApiEnvelopedResponse`/`ApiEnvelopedPaginatedResponse`/`ApiEnvelopedEmptyResponse`)를 신설해 전체 엔드포인트에 연결. `SWAGGER_ENABLED=true`일 때 `/docs`에서 요청/응답 스키마·example이 실제 API 응답 모양 그대로 채워진 문서로 확인 가능
  - ✅ E2E 테스트 스위트(`docs/03_DEV_SETUP.md` 5.3) — 문서화된 42개 엔드포인트 전체를 실제 로컬 DB로 검증하는 E2E 테스트 8개 도메인/141개(`npm run test:e2e`). 실행마다 DB를 TRUNCATE 후 시드 재적용하는 자동 리셋(`test/global-setup.ts`), `.env.test`로 dev DB와 분리된 전용 테스트 DB 지정 가능(선택). 이 과정에서 실제 애플리케이션 결함(크론 배치 5개의 그레이스풀 셧다운 미비)도 발견해 함께 수정
- ✅ Frontend 구현 완료(`docs/03_DEV_SETUP.md`, React 18 + TypeScript + Vite + Ant Design + Zustand + Axios)
  - ✅ 구조 스캐폴딩 — 레이아웃 3종(AuthLayout/MainLayout/AdminLayout), 라우트 전체 골격(`18_LAYOUT.md` 7장), role 기반 가드 4종(`RoleGuard`/`PermissionGuard`/`RequireAuth`/`RequireGuest`/`RequireProjectSelected`), Zustand `authStore`/`globalStore`, axios 클라이언트(Access Token 자동 첨부 + 만료 시 자동 재발급·재시도)
  - ✅ 빌드 최적화 — 라우트별 `React.lazy` 코드 스플리팅 + `vite.config.ts` 벤더 청크 분리(antd/react·router/i18next/기타)로 단일 1.4MB 청크를 라우트별 수십 kB대로 분리(`04_DEV_CONVENTIONS.md` 2.1)
  - ✅ 로그인(SCR-001) + 내 계정 조회·로그아웃(SCR-200) — 실제 백엔드 연동, 브라우저 라이브 검증 완료
  - ✅ 다국어(i18n) — react-i18next로 ko/en 지원, 로그인 화면 포함 전체 공통 UI(헤더/사이드바/푸터/에러 페이지) 번역 + 언어 선택 드롭다운(`localStorage` 유지), 백엔드 에러 메시지는 한글 유지가 원칙(`02_TECH_STACK.md` 참고)
  - ✅ 회원가입(SCR-002) — 회사/프로젝트 코드 텍스트 입력(드롭다운 아님, 인증 불필요 lookup API 사용) + 제출 시점 검증, 실제 백엔드 연동, 브라우저 라이브 검증 완료. 구현 중 `requested_project_id`가 문서(선택)와 실제 백엔드(필수 강제)가 어긋난 걸 발견해 백엔드를 선택 입력으로 수정(`SignupDto`/`SP_USER_SIGNUP`)
  - ✅ 관리메뉴 — 회사(SCR-010–012, 목록/등록/상세수정), 프로젝트(SCR-020–022, 목록/등록/상세수정 + API Secret 재발급 — `edit_count` 낙관적 락, 등록·재발급 시 평문 Secret 1회 노출 모달), 사용자(SCR-030–031, 목록/상세 + 승인·반려·반려취소·수정·비밀번호강제초기화·프로젝트 권한배정), 감사로그(SCR-040–041, 목록/상세 — before/after JSON 비교, 회사/프로젝트 이름 resolve) 실제 백엔드 연동 + SUPER_ADMIN·DEVELOPER 권한별 화면(조회전용/스코핑) 브라우저 라이브 검증 완료. 목록 화면 상태/필터에 "전체" 옵션 추가
  - ✅ 캠페인 목록·등록·상세(SCR-100~102) — 목록(프로젝트/상태/승인상태/발급상태/코드유형 필터), 등록(RANDOM/FIXED 분기), 상세(탭 4개: 정보·코드목록·사용이력·변경이력 — 정보 탭은 `edit_count` 낙관적 락 수정 + 상태전이 + 승인/반려, 코드목록 탭은 RANDOM 발급/재시도/중단 + FIXED 등록) 실제 백엔드 연동 + 브라우저 라이브 검증 완료. 캠페인 활성화/재활성화에 `campaign_end > NOW()` 조건 추가(사용기간이 지난 캠페인은 활성화 자체를 막음 — `19_CAMPAIGN_API.md` 2.5)
  - ✅ 헤더 실시간 서버 시각 — `GET /health`의 `server_time`으로 클라이언트-서버 시계 오프셋을 계산해 표시(초당 폴링 아님, 5분마다 재동기화). 기기 시계가 어긋나 있어도 실제 판정 기준(서버 시각)을 보여주기 위함
  - ✅ 쿠폰 사용 로그(SCR-103) — 캠페인/유저/코드값/작업유형/결과/기간 필터 + 페이지네이션, 캠페인 열은 값이 있는 행만 SCR-102로 링크(존재하지 않는 코드로 시도한 행은 `coupon_campaign_id`가 null이라 링크 없이 코드값만 표시) 실제 백엔드 연동 + 브라우저 라이브 검증 완료. 이걸로 화면 목록 전체 구현 완료

### 향후 개선사항 (우선순위 낮음, 별도 검토 필요)

- **Redis 도입**(총 3개 대상 전부 완료, 2026-08-05):
  1. ✅ `project_api_nonce`(S2S nonce 재전송 방지) — 공용 `RedisModule`/`RedisService`(ioredis) 신설, `S2sAuthGuard.consumeNonce`가 Redis `SET NX EX`를 1차 경로로 쓰고 Redis 장애 시 기존 DB 경로(`SP_NONCE_INSERT`)로 fail-open 폴백한다(`02_TECH_STACK.md` "Redis" 절, `09_AUTH_SECURITY.md` 2.5). 당초 예상과 달리 fail-open 설계 특성상 DB가 완전히 안 쓰이는 건 아니라 `S2S_NONCE_CLEANUP_CRON`/`NonceCleanupService`는 그대로 유지
  2. ✅ `user_session` — 저장소 자체 이관이 아니라 `JwtAuthGuard.validateSession`(매 인증된 요청마다 도는 jti→세션 검증)의 **읽기 캐시**로 구현(`SessionCacheService`) — DB가 항상 source of truth. 로그아웃/비밀번호변경(변경·초기화)/계정정지 시 유저 단위 generation 카운터를 올려 그 유저의 캐시된 세션 전체를 일괄 무효화하고, `refresh()`의 jti 회전은 이전 jti만 정밀 삭제한다(`09_AUTH_SECURITY.md` 1.3.1). 카운터 TTL이 캐시 TTL보다 짧으면 무효화가 우연히 원상복구되는 보안 구멍이 생겨, 이 관계를 Joi로 부팅 시점에 강제
  3. ✅ 쿠폰 사용(reserve/confirm) **유저 단위 rate limit** — 프로젝트 단위(인프라 보호, in-memory 토큰버킷)와 별개 레이어로 `SlidingWindowCounterLimiter` 신규 구현. 목적은 "특정 유저의 과도한 호출이 같은 프로젝트의 공유 버킷을 소진해 다른 유저까지 영향받는" 상황을 막는 2차 방어선(SP 레벨의 `use_limit_per_user`가 이미 실제 소비 한도는 원자적으로 강제하고, S2S 호출 주체인 게임서버 쪽에서도 1차 조절 여지가 있어 필수 방어선은 아님). 알고리즘은 고정윈도우(경계 버스트)/토큰버킷(분산환경에서 Lua 사실상 필수)/슬라이딩윈도우로그(유저 수만큼 메모리 부담) 대비 **슬라이딩 윈도우 카운터**로 확정 — `RedisService.get`/`incrWithExpire`만으로 구현(Lua 불필요), `09_AUTH_SECURITY.md` 2.8.2. `REDIS_ENABLED=false`면 대체 경로 없이 완전히 스킵(1·2단계와 달리 폴백 대상 자체가 없는 신규 기능)

  프로젝트 단위 rate limiter(`CouponUsageRateLimitMiddleware`)는 in-memory로 유지하기로 확정된 설계라 이관 대상 아님. 크론 배치 리더선출(`SpExecutorService.runExclusive`, `SP_LOCK_ACQUIRE`/`RELEASE`)도 의도적으로 MySQL만 사용하며 Redis 이관 대상이 아니다(`04_DEV_CONVENTIONS.md` 4.1).
- ✅ **레이트리밋 초과(429) 이력 로깅** — 처음엔 `s2s-failure.log`류 파일 로그로 검토했으나, 회사/프로젝트 단위 집계·조회가 필요해 `log_coupon_rate_limit`(로그 DB) **테이블**로 확정(`09_AUTH_SECURITY.md` 2.8.3). 프로젝트/유저 단위 두 리미터 모두 429 시 fire-and-forget으로 기록. 리젝트 시점엔 `S2sAuthGuard` 인증 전이라 `project_id`/`company_id`가 없는 문제는 신규 `ProjectIdentityCacheService`(`api_key -> {project_id, company_id}`, Redis 캐시 우선 + `SP_PROJECT_GET_IDENTITY_BY_API_KEY` 폴백, `ProjectService.create()` write-through)로 해결 — 존재하지 않는 api_key는 해석 실패로 NULL 기록(의도된 동작). 실시간 알림(Slack/이메일 등) 연동은 이 프로젝트에 그 인프라가 없어 범위 밖으로 남김.
- **회사(company) 단위 rate limit** — 프로젝트/유저 단위에 이어 회사(여러 프로젝트를 소유) 단위 집계까지 검토했으나, `CouponUsageRateLimitMiddleware`/`CouponUsageUserRateLimitMiddleware`는 `S2sAuthGuard` 인증 **이전**(원문 API Key 헤더만 아는 시점)에 실행돼 `company_id`를 알 수 없다 — 이 계층에서 걸려면 인증 이후(가드/서비스 레이어)로 옮기거나 API Key→company_id 캐시가 별도로 필요해 설계 논의가 더 필요하다고 판단해 별도 단계로 이연.
- **`react-router` 메이저 업그레이드(7→8)** — `npm audit`에서 High로 잡히는 CVE(GHSA-qwww-vcr4-c8h2, RSC 모드 CSRF 우회)는 `createBrowserRouter`/`RouterProvider`/`loader`/`action` 없이 `<BrowserRouter>`+`<Routes>`+`<Route>` 선언형 모드만 쓰는 이 프로젝트에는 실질적으로 노출되지 않는다. 반면 패치 버전인 v8은 `react-router-dom` 패키지 자체가 폐지되고(`react-router`/`react-router/dom`으로 import 경로 전환 필요) `react >=19.2.7`을 요구해, 2026-07-24에 명시적으로 확정한 "React 18 유지" 결정(`02_TECH_STACK.md`)까지 되돌려야 한다. 지금 업그레이드하기엔 실익 대비 비용이 커 보류 — React 19 전환을 별도로 결정하는 시점에 함께 처리.

---

## 라이선스

이 프로젝트는 포트폴리오/학습 목적으로 공개됩니다. 개인적인 학습·열람·참고 용도로는 자유롭게 사용할 수 있으나, 상업적 이용(영리 목적 사용, 재배포, 상용 서비스에의 포함 등)은 금지됩니다. 자세한 내용은 [LICENSE.md](LICENSE.md)를 참고하세요.
