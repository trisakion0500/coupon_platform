# coupon_platform

> 여러 게임이 하나의 플랫폼을 공유해 쓰는 멀티테넌트 쿠폰 발급/사용 서버

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
| 인증        | JWT(HS256) + user_session                |
| S2S 인증    | API Key + HMAC-SHA256 요청 서명          |
| 비밀번호    | bcrypt (rounds=12)                       |
| 로깅        | log_audit / log_coupon_campaign / log_coupon_use + application log(log4js) |

> **왜 SP/Function 전용으로 강제했는가**
> 정합성이 중요한 도메인(코드 중복소모 방지, 캠페인 오버셀 방지, 낙관적 동시성 제어)일수록 애플리케이션 레이어의 트랜잭션 코드보다 DB 제약·락으로 강제하는 편이 실수할 여지가 적다. ORM이나 Native SQL 직접 작성을 금지하고 모든 쓰기를 Stored Procedure로 강제한 이유다 — `docs/02_DEV_CONVENTIONS.md` 참고.

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

세부 환경변수 및 버전은 [`docs/01_TECH_STACK.md`](docs/01_TECH_STACK.md) 참고.

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
| [01_TECH_STACK.md](docs/01_TECH_STACK.md) | 기술 스택, 환경변수 |
| [02_DEV_CONVENTIONS.md](docs/02_DEV_CONVENTIONS.md) | 로깅 원칙, 코드 모듈화 기준, SP 네이밍, 동시성 처리 컨벤션 |
| [03_ERD.md](docs/03_ERD.md) | 전체 테이블 ERD, 비정규화 FK, 상태코드 요약 |
| [04_DATABASE_SCHEMA.md](docs/04_DATABASE_SCHEMA.md) | 테이블별 특징/상태/특수규칙 |
| [05_COUPON_ISSUANCE_SCENARIO.md](docs/05_COUPON_ISSUANCE_SCENARIO.md) | 캠페인/코드 발급 흐름, 비동기 생성, 재시도 처리 |
| [06_COUPON_USAGE_SCENARIO.md](docs/06_COUPON_USAGE_SCENARIO.md) | 쿠폰 사용 흐름, 동시성 처리 |
| [07_AUTH_SECURITY.md](docs/07_AUTH_SECURITY.md) | 사용자 인증, S2S 인증 정책 |
| [08_API_COMMON.md](docs/08_API_COMMON.md) | 응답포맷/에러코드/페이지네이션 |
| [09_AUTH_API.md](docs/09_AUTH_API.md) | 회원가입/로그인/로그아웃 등 |
| [10_COMPANY_API.md](docs/10_COMPANY_API.md) | 회사 CRUD |
| [11_PROJECT_API.md](docs/11_PROJECT_API.md) | 프로젝트 CRUD, Secret 발급/재발급 |
| [12_USER_API.md](docs/12_USER_API.md) | 사용자 승인/반려/권한 배정 |
| [13_LOG_AUDIT_API.md](docs/13_LOG_AUDIT_API.md) | 감사로그 조회 |
| [14_MENU_PERMISSION.md](docs/14_MENU_PERMISSION.md) | 역할별 메뉴 접근 권한 |
| [15_SCREEN_LIST.md](docs/15_SCREEN_LIST.md) | 화면 목록 및 연관 API |
| [16_LAYOUT.md](docs/16_LAYOUT.md) | 레이아웃, 라우트, 공통 컴포넌트 |
| [17_CAMPAIGN_API.md](docs/17_CAMPAIGN_API.md) | 캠페인 CRUD, 상태변경, 승인/반려, 코드 발급(RANDOM 비동기/FIXED 동기) |
| [18_COUPON_USAGE_API.md](docs/18_COUPON_USAGE_API.md) | 쿠폰 사용 reserve/confirm, 미컨슘 조회 |
| [19_DEV_SETUP.md](docs/19_DEV_SETUP.md) | 로컬 개발 환경 설정 |

---

## 프로젝트 구조

```
coupon_platform/
├── backend/            # Backend (NestJS)
├── frontend/           # Frontend (React, 구조+로그인 세로슬라이스 완료)
├── database/
│   ├── tables/         # 메인 DB DDL(.sql, all_tables.sql 포함)
│   ├── procedures/     # 메인 DB Stored Procedure
│   └── functions/      # 메인 DB Function
├── database_log/
│   ├── tables/         # 로그 DB DDL(메인 DB와 물리 분리)
│   └── procedures/     # 로그 DB 전용 Stored Procedure
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
- ✅ API 명세 작성 완료 (`docs/01~19`)
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
  - ✅ 사용기간 만료 캠페인 자동 종료 — 활성+승인완료(또는 승인불요) 상태에서 `campaign_end`가 지나면 배치가 `status=4`(종료)로 전환(`CampaignExpiryService`, 종료 후엔 예외 없이 모든 수정 차단)
  - ✅ 운영 보완 — 로그 파일 일별 로테이션 + ERROR 전용 분리, S2S 호출자 IP 기록, 전역 API 실행 타임아웃, reserve/confirm 프로젝트 단위 rate limiter(토큰 버킷)
  - ✅ Swagger 문서화 — `nest-cli.json`에 swagger CLI 플러그인(`classValidatorShim`) 등록 + 전체 요청 DTO(32개)에 `@ApiProperty()`/`@ApiPropertyOptional()`(설명/예시 포함) 추가. 응답 스키마도 문서화 완료 — 응답 타입(순수 TS interface)을 데코레이터 붙은 클래스로 옮기고, `{result, data}` 응답 봉투까지 그대로 반영하는 공용 데코레이터(`ApiEnvelopedResponse`/`ApiEnvelopedPaginatedResponse`/`ApiEnvelopedEmptyResponse`)를 신설해 전체 엔드포인트에 연결. `SWAGGER_ENABLED=true`일 때 `/docs`에서 요청/응답 스키마·example이 실제 API 응답 모양 그대로 채워진 문서로 확인 가능
  - ✅ E2E 테스트 스위트(`docs/19_DEV_SETUP.md` 5.3) — 문서화된 42개 엔드포인트 전체를 실제 로컬 DB로 검증하는 E2E 테스트 8개 도메인/141개(`npm run test:e2e`). 실행마다 DB를 TRUNCATE 후 시드 재적용하는 자동 리셋(`test/global-setup.ts`), `.env.test`로 dev DB와 분리된 전용 테스트 DB 지정 가능(선택). 이 과정에서 실제 애플리케이션 결함(크론 배치 5개의 그레이스풀 셧다운 미비)도 발견해 함께 수정
- ✅ Frontend 구현 완료(`docs/19_DEV_SETUP.md`, React 18 + TypeScript + Vite + Ant Design + Zustand + Axios)
  - ✅ 구조 스캐폴딩 — 레이아웃 3종(AuthLayout/MainLayout/AdminLayout), 라우트 전체 골격(`16_LAYOUT.md` 7장), role 기반 가드 4종(`RoleGuard`/`PermissionGuard`/`RequireAuth`/`RequireGuest`/`RequireProjectSelected`), Zustand `authStore`/`globalStore`, axios 클라이언트(Access Token 자동 첨부 + 만료 시 자동 재발급·재시도)
  - ✅ 로그인(SCR-001) + 내 계정 조회·로그아웃(SCR-200) — 실제 백엔드 연동, 브라우저 라이브 검증 완료
  - ✅ 다국어(i18n) — react-i18next로 ko/en 지원, 로그인 화면 포함 전체 공통 UI(헤더/사이드바/푸터/에러 페이지) 번역 + 언어 선택 드롭다운(`localStorage` 유지), 백엔드 에러 메시지는 한글 유지가 원칙(`01_TECH_STACK.md` 참고)
  - ✅ 회원가입(SCR-002) — 회사/프로젝트 코드 텍스트 입력(드롭다운 아님, 인증 불필요 lookup API 사용) + 제출 시점 검증, 실제 백엔드 연동, 브라우저 라이브 검증 완료. 구현 중 `requested_project_id`가 문서(선택)와 실제 백엔드(필수 강제)가 어긋난 걸 발견해 백엔드를 선택 입력으로 수정(`SignupDto`/`SP_USER_SIGNUP`)
  - ✅ 관리메뉴 — 회사(SCR-010–012, 목록/등록/상세수정), 프로젝트(SCR-020–022, 목록/등록/상세수정 + API Secret 재발급 — `edit_count` 낙관적 락, 등록·재발급 시 평문 Secret 1회 노출 모달), 사용자(SCR-030–031, 목록/상세 + 승인·반려·반려취소·수정·비밀번호강제초기화·프로젝트 권한배정), 감사로그(SCR-040–041, 목록/상세 — before/after JSON 비교, 회사/프로젝트 이름 resolve) 실제 백엔드 연동 + SUPER_ADMIN·DEVELOPER 권한별 화면(조회전용/스코핑) 브라우저 라이브 검증 완료. 목록 화면 상태/필터에 "전체" 옵션 추가
  - ✅ 캠페인 목록·등록·상세(SCR-100~102) — 목록(프로젝트/상태/승인상태/발급상태/코드유형 필터), 등록(RANDOM/FIXED 분기), 상세(탭 4개: 정보·코드목록·사용이력·변경이력 — 정보 탭은 `edit_count` 낙관적 락 수정 + 상태전이 + 승인/반려, 코드목록 탭은 RANDOM 발급/재시도/중단 + FIXED 등록) 실제 백엔드 연동 + 브라우저 라이브 검증 완료. 캠페인 활성화/재활성화에 `campaign_end > NOW()` 조건 추가(사용기간이 지난 캠페인은 활성화 자체를 막음 — `17_CAMPAIGN_API.md` 2.5)
  - ✅ 헤더 실시간 서버 시각 — `GET /health`의 `server_time`으로 클라이언트-서버 시계 오프셋을 계산해 표시(초당 폴링 아님, 5분마다 재동기화). 기기 시계가 어긋나 있어도 실제 판정 기준(서버 시각)을 보여주기 위함
  - ✅ 쿠폰 사용 로그(SCR-103) — 캠페인/유저/코드값/작업유형/결과/기간 필터 + 페이지네이션, 캠페인 열은 값이 있는 행만 SCR-102로 링크(존재하지 않는 코드로 시도한 행은 `coupon_campaign_id`가 null이라 링크 없이 코드값만 표시) 실제 백엔드 연동 + 브라우저 라이브 검증 완료. 이걸로 화면 목록 전체 구현 완료

### 향후 개선사항 (우선순위 낮음, 별도 검토 필요)

- 쿠폰 사용(reserve/confirm) API의 **유저 단위(오남용 방지) rate limit** — 프로젝트 단위(인프라 보호)는 구현 완료(위 항목 참고), 특정 유저의 반복 어뷰징까지 잡는 이중 적용은 **알려진 TODO로 보류 중**. 프로젝트 단위와 달리 유저 단위는 스케일아웃 환경에서 인스턴스별 in-memory 카운터로는 실효 한도가 인스턴스 수배로 늘어나는 문제가 더 크게 체감된다(유저 수가 프로젝트 수보다 훨씬 많아 카운터 자체도 무겁고, 어뷰징 방지 목적상 정확한 합산 카운트가 중요) — 지금 인프라(Redis 없음)로 어설프게 구현하기보다, 아래 Redis 도입과 함께 정확한 분산 카운터로 구현하는 쪽이 낫다고 판단해 명시적으로 뒤로 미뤄둠.
- **Redis 도입 시 함께 이관할 대상**(총 3개):
  1. 유저 단위 rate limit 카운터 — 위 항목, Redis 도입 시점에 맞춰 신규 구현
  2. `project_api_nonce` — S2S nonce 재전송 방지용, Redis로 가면 TTL 자연만료라 정리 배치(`S2S_NONCE_CLEANUP_CRON`) 자체가 불필요해짐
  3. `user_session` — Redis로 가면 TTL 자연만료라 `SESSION_CLEANUP_CRON` 불필요해짐 — `user_session.user_id`에 FK를 안 건 것도 애초에 이 전환을 대비한 설계(`04_DATABASE_SCHEMA.md` 참고)

  프로젝트 단위 rate limiter(`CouponUsageRateLimitMiddleware`)는 in-memory로 유지하기로 확정된 설계라 이관 대상 아님.

---

## 라이선스

이 프로젝트는 포트폴리오/학습 목적으로 공개됩니다. 개인적인 학습·열람·참고 용도로는 자유롭게 사용할 수 있으나, 상업적 이용(영리 목적 사용, 재배포, 상용 서비스에의 포함 등)은 금지됩니다. 자세한 내용은 [LICENSE.md](LICENSE.md)를 참고하세요.
