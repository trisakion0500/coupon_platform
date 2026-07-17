# coupon_platform

여러 게임(프로젝트)이 가입해 쓰는 **멀티테넌트 쿠폰 발급/사용 플랫폼** 포트폴리오 프로젝트입니다.

게임서버가 쿠폰 발급/사용 검증을 위해 이 서버를 호출하고, 관리 콘솔(웹)로 회사/프로젝트/사용자/쿠폰을 운영하는 구조를 목표로 설계하고 있습니다.

## 주요 특징

- **멀티테넌시**: 회사(company) → 프로젝트(project) 단위로 데이터가 격리되며, 코드값 유니크 범위도 프로젝트 단위로 스코핑됩니다.
- **이중 인증 체계**: 관리 콘솔 사용자는 JWT(HS256) + 세션, 게임서버는 API Key + Secret(SHA-256 해시, 유예기간 로테이션) 기반 서버간(S2S) 인증을 사용합니다.
- **4단계 역할 체계**: SUPER_ADMIN / DEVELOPER / MANAGER / OPERATOR — 쿠폰 도메인 작업은 역할에 따라 즉시 반영되거나 승인 워크플로우를 거칩니다.
- **즉시 확정형 쿠폰 사용 흐름**: 인앱결제 consume/acknowledge 패턴을 참고해 reserve 시점에 즉시 소모를 확정하고, confirm은 결과 통보로만 동작하도록 설계해 분산 트랜잭션 이슈를 회피합니다.
- **동시성 안전성**: 코드 중복 소모, 캠페인 오버셀, 사용자별 한도 초과 등을 조건부 UPDATE와 갭락으로 방지합니다.
- **로그 도메인 분리**: 시스템관리자 / 플랫폼운영자 / 유저 영역별로 조회 권한이 다른 로그 테이블을 분리하고, 향후 별도 DB로 물리 분리되어도 메인 트랜잭션이 영향받지 않도록 설계했습니다.

## 기술 스택

- **Backend**: Node.js 22 LTS + NestJS + TypeScript
- **DB**: MySQL 8.4 + mysql2 (Stored Procedure/Function 전용)
- **Frontend**: React 18 + TypeScript + Vite + Ant Design + Zustand + Axios
- **인증**: JWT(HS256) / API Key+Secret(S2S)

세부 환경변수 및 버전은 [`docs/01_TECH_STACK.md`](docs/01_TECH_STACK.md) 참고.

## 디렉터리 구조

```
database/tables/   개별 테이블 DDL(.sql) + all_tables.sql 통합본
docs/               ERD, 스키마, API 명세, 화면/레이아웃 설계 문서
```

## 데이터베이스

기본 도메인(company/project/user/user_role/user_session), 쿠폰 도메인(coupon_campaign/coupon_code/coupon_code_usage), 로그(log_audit/log_coupon_campaign/log_coupon_use) 총 11개 테이블로 구성되어 있습니다.

- ERD: [`docs/02_ERD.md`](docs/02_ERD.md)
- 테이블별 상세 설계: [`docs/03_DATABASE_SCHEMA.md`](docs/03_DATABASE_SCHEMA.md)
- 캠페인/코드 발급 시나리오: [`docs/04_COUPON_ISSUANCE_SCENARIO.md`](docs/04_COUPON_ISSUANCE_SCENARIO.md)
- 쿠폰 사용(reserve/confirm) 시나리오: [`docs/05_COUPON_USAGE_SCENARIO.md`](docs/05_COUPON_USAGE_SCENARIO.md)

## 문서 목록

| 번호 | 문서 | 내용 |
| ---- | ---- | ---- |
| 01 | [TECH_STACK](docs/01_TECH_STACK.md) | 기술 스택, 환경변수 |
| 02 | [ERD](docs/02_ERD.md) | 전체 테이블 ERD, 비정규화 FK, 상태코드 요약 |
| 03 | [DATABASE_SCHEMA](docs/03_DATABASE_SCHEMA.md) | 테이블별 특징/상태/특수규칙 |
| 04 | [COUPON_ISSUANCE_SCENARIO](docs/04_COUPON_ISSUANCE_SCENARIO.md) | 캠페인/코드 발급 흐름, 비동기 생성, 재시도 처리 |
| 05 | [COUPON_USAGE_SCENARIO](docs/05_COUPON_USAGE_SCENARIO.md) | 쿠폰 사용 흐름, 동시성 처리 |
| 06 | [AUTH_SECURITY](docs/06_AUTH_SECURITY.md) | 사용자 인증, S2S 인증 정책 |
| 07 | [API_COMMON](docs/07_API_COMMON.md) | 응답포맷/에러코드/페이지네이션 |
| 08 | [AUTH_API](docs/08_AUTH_API.md) | 회원가입/로그인/로그아웃 등 |
| 09 | [COMPANY_API](docs/09_COMPANY_API.md) | 회사 CRUD |
| 10 | [PROJECT_API](docs/10_PROJECT_API.md) | 프로젝트 CRUD, Secret 발급/재발급 |
| 11 | [USER_API](docs/11_USER_API.md) | 사용자 승인/반려/권한 배정 |
| 12 | [LOG_AUDIT_API](docs/12_LOG_AUDIT_API.md) | 감사로그 조회 |
| 13 | [MENU_PERMISSION](docs/13_MENU_PERMISSION.md) | 역할별 메뉴 접근 권한 |
| 14 | [SCREEN_LIST](docs/14_SCREEN_LIST.md) | 화면 목록 및 연관 API |
| 15 | [LAYOUT](docs/15_LAYOUT.md) | 레이아웃, 라우트, 공통 컴포넌트 |

## 현재 진행 상황

DB 설계(테이블 11개) 및 관련 문서가 완료된 상태이며, 다음 작업이 남아 있습니다.

- 쿠폰 도메인 상세 API 스펙 (reserve/confirm/미컨슘 조회)
- 캠페인/코드 발급(관리자) API 설계
- S2S 인증 세부 스펙
- 쿠폰 컨트롤 화면 및 관련 메뉴/레이아웃 세부

백엔드/프론트엔드 구현은 아직 시작 전입니다.
