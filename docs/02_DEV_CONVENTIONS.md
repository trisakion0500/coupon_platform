# 02_DEV_CONVENTIONS.md

# 개발 컨벤션

실제 코드를 작성할 때 따르는 컨벤션을 모아둔 문서다. 프로젝트 설계 배경/의사결정 과정 같은 협업 방식 규칙은 여기 포함하지 않는다(리포에 커밋되지 않는 로컬 `CLAUDE.md`에서 관리).

---

# 1. 로깅 원칙

`log_audit`/`log_coupon_campaign`/`log_coupon_use` 등 로그 테이블은 **메인 서비스 DB와 물리적으로 별도인 DB에 둔다** — "향후 분리될 수도 있다"는 가능성이 아니라 확정된 전제이며, 2026.07.19부터 **로컬 개발 환경에서도** 실제로 분리되어 있다(`coupon_platform`=메인, `coupon_platform_log`=로그 전용 DB). DDL은 `database_log/tables/`(개별 파일 + `all_log_tables.sql` 통합본)에 있고, `database/tables/all_tables.sql`에는 더 이상 포함되지 않는다 — 메인 DB용 `database/`와 로그 DB용 `database_log/`를 별도 최상위 폴더로 분리해 물리적 DB 분리를 폴더 구조에서도 드러낸다. 접속 계정은 메인 DB와 같을 수도, 다를 수도 있어(운영 환경에서는 별도 계정일 가능성이 높음) 환경변수를 따로 관리한다(`LOG_DB_HOST`/`LOG_DB_PORT`/`LOG_DB_USER`/`LOG_DB_PASSWORD`/`LOG_DB_NAME`, `01_TECH_STACK.md` 참고). 과거 로그 적재 문제로 DB 전체가 장애를 겪은 경험 때문에, 로그가 안 쌓이는 상황이 오더라도 메인 트랜잭션(쿠폰 발급/사용 등 핵심 기능)은 절대 실패하면 안 된다.

- 로그 테이블에 FK를 걸지 않는다(물리적으로 분리된 DB는 FK로 묶을 수 없음)
- 로그 조회에 필요한 참조 정보는 조인 없이 볼 수 있도록 스냅샷 컬럼(예: `created_by_name`)으로 미리 비정규화해둔다
- **로그 기록은 메인 트랜잭션과 같은 DB 커넥션/트랜잭션에 절대 묶이지 않는다** — 물리적으로 다른 DB라 애초에 같은 트랜잭션으로 묶을 수도 없다(분산 트랜잭션/XA 사용 안 함). 메인 SP가 커밋된 뒤 별도 커넥션으로 로그 기록을 시도하고, 그 시도가 실패해도 메인 트랜잭션을 재시도·롤백시키지 않는다(강한 결합 금지) — 백엔드에서는 `SpExecutorService`(메인 DB)와 별개인 `LogSpExecutorService`(로그 DB, 별도 커넥션 풀)로 이 원칙을 구조적으로 강제한다

## 1.1 애플리케이션 로그(HTTP 요청/응답) 상세 기록 및 민감정보 마스킹

위 항목들은 DB 로그 테이블(`log_audit` 등) 얘기고, 이 절은 log4js가 남기는 **애플리케이션 로그**(`logs/app.log`) 얘기다. 원래는 500 이상 오류만 `METHOD URL -> STATUS`로 남고 요청/응답 바디는 전혀 기록되지 않았다(2026-07-23 보완) — `RequestResponseLoggingMiddleware`(`backend/src/common/logging/request-response-logging.middleware.ts`, `AppModule.configure()`로 전 라우트에 적용)가 성공/실패 무관하게 모든 요청을 `REQ`(요청)/`RES`(응답) 두 줄로 남기고, 같은 요청의 두 줄을 8자리 요청 ID로 짝지어준다.

- 요청 바디/응답 바디는 응답이 어느 경로(`ResponseInterceptor`의 성공 응답이든 `HttpExceptionFilter`의 오류 응답이든)로 만들어지든 결국 Express의 `res.json`/`res.send`를 거치므로, 이 두 메서드만 감싸면 전 경로를 빠짐없이 포착할 수 있다.
- **민감정보는 `maskSensitiveData`(`backend/src/common/logging/sensitive-data-masker.util.ts`)로 재귀 마스킹한 뒤 남긴다** — `password`/`new_password`/`old_password`/`password_hash`/`phone_number`/`access_token`/`refresh_token`/`api_secret`/`api_secret_prev`/`Authorization`/`X-API-Signature` 키(대소문자 무시)는 중첩 깊이·배열 안 여부와 무관하게 값을 `***`로 치환한다. 새 도메인에 비밀값(새 토큰 종류, 새 비밀번호 필드 등)이 추가되면 이 목록에도 반드시 함께 추가할 것 — 로그가 사후에 새는 것보다 코드리뷰 시점에 놓치지 않는 게 안전하다.
- 대량 목록 응답 등으로 로그 한 줄이 지나치게 길어지는 것을 막기 위해 바디 문자열은 5000자에서 잘라 `...(truncated)`를 붙인다.

## 1.2 API 실행 타임아웃

`API_EXECUTION_TIMEOUT_MS`(기본 30000ms, `01_TECH_STACK.md`)를 전역 `TimeoutInterceptor`(`backend/src/common/response/timeout.interceptor.ts`, `main.ts`에서 `ResponseInterceptor` 뒤에 등록)가 소비한다(2026-07-23 도입 — 그 전에는 값 검증만 있고 실제로 소비하는 코드가 없었다). 컨트롤러 핸들러가 이 시간 안에 응답을 만들지 못하면 RxJS `timeout()`이 던지는 `TimeoutError`를 잡아 `BusinessException(ResultCode.API_EXECUTION_TIMEOUT)`(408, `08_API_COMMON.md` 1.3/8장 `50002`)으로 변환한다.

- **인터셉터 등록 순서가 중요하다**: `ResponseInterceptor`를 먼저, `TimeoutInterceptor`를 나중에 등록해야 한다 — Nest의 인터셉터는 등록 순서대로 바깥→안쪽으로 감싸므로, 나중에 등록한 쪽이 컨트롤러 실행에 더 가깝다. `TimeoutInterceptor`가 컨트롤러 핸들러의 Observable에 직접 `timeout()`을 걸어야 하므로 안쪽에 있어야 하고, `ResponseInterceptor`는 성공 응답만 `map()`으로 감싸 오류를 그대로 통과시키므로 바깥에서 타임아웃 예외를 가로막지 않는다.
- **타임아웃은 "클라이언트에게 실패를 알림"일 뿐 "DB 작업 취소"가 아니다** — RxJS `timeout()`은 구독을 취소할 뿐, 이미 던져진 SP 호출(mysql2 쿼리)을 서버 사이드에서 강제 종료하지 못한다. 즉 408 응답이 나간 뒤에도 해당 SP는 계속 실행되다 커밋될 수 있다. `POST /v1/coupons/reserve`처럼 상태를 바꾸는 API가 이미 멱등하게 설계된 것(`06_COUPON_USAGE_SCENARIO.md` 1.2)이 이 한계에 대한 실질적 방어선이다 — 새 쓰기 API를 추가할 때도 "타임아웃 이후 커밋될 수 있다"는 전제 하에 재시도 안전성을 갖추도록 한다.
- RANDOM 코드 대량생성(`CampaignCodeService.generateRandomCodes`)처럼 컨트롤러 응답과 분리된 fire-and-forget 백그라운드 작업은 이 인터셉터가 감싸는 Observable 범위 밖이라 타임아웃 대상이 아니다.

## 1.3 S2S 실패 운영 로그

`POST /v1/coupons/{code}/reserve`/`confirm`이 실패(result≠0)할 때마다 `CouponUsageService.logS2sFailure`가
`logs/s2s-failure.log`(log4js `s2s-failure` 카테고리, `code-generation-stale`와 동일한 전용 파일
분리 패턴)에 한 줄을 남긴다(2026-07-27) — `log_coupon_use` DB 기록과는 별개로, DB 조회 없이
파일만 tail해도 실패만 바로 훑어볼 수 있게 하기 위함이다.

```
[company_code][project_code] [campaign_id]-요청파라미터전부-실패사유
```

`company_code`/`project_code`는 `S2sAuthGuard`가 `SP_PROJECT_GET_BY_API_KEY`로 매 요청마다 이미
조회해 `request.s2sProject`에 붙여두는 값을 그대로 재사용한다(별도 DB 조회 없음). `campaign_id`는
코드 자체가 존재하지 않았던 실패(31005)나 `game_user_id` 누락(30001)처럼 캠페인을 특정할 수 없는
경우 `-`로 남는다. `unconfirmed`(3.1)는 특정 캠페인 하나를 대상으로 하는 액션이 아니라 이 로그
대상이 아니다.

---

# 2. 코드 모듈화 원칙

- **두 번 이상 중복되는 코드는 모듈화한다**: 동일하거나 사소한 차이만 있는 로직이 두 곳 이상에서 쓰이게 되면 공통 함수/모듈로 분리한다.
- **개발 초기에 자주 쓰일 공통 기능은 먼저 모듈화한다**: DB 커넥션(mysql2 풀 획득/해제, SP 호출 래퍼), 공통 응답 포맷(result/data) 빌더, S2S 인증 가드 등 프로젝트 전반에서 반복 호출될 인프라성 기능은 개별 도메인 로직을 만들기 전에 먼저 공통 모듈로 정리해둔다.

## 2.1 요청/응답 DTO는 `@ApiProperty()`를 함께 작성한다

`nest-cli.json`에 `@nestjs/swagger` CLI 플러그인(`classValidatorShim: true`)이 등록돼 있어 필수/타입 추론은 어느 정도 자동화되지만, 설명(description)과 example 값은 자동 생성되지 않는다. 새 요청 DTO(`*.dto.ts`)를 추가하거나 필드를 수정할 때는 `@ApiProperty()`(필수)/`@ApiPropertyOptional()`(선택)를 함께 붙여 `description`과 `example`을 채운다 — enum류 필드는 값의 실제 의미를 한글로 명시한다(예: `역할 코드(20:DEVELOPER/30:MANAGER/40:OPERATOR)`).

**응답도 동일 컨벤션을 따른다** — 컨트롤러가 반환하는 값은 서비스 내부의 순수 TS interface(예: `CampaignRow`)를 그대로 노출하지 말고, `*-response.dto.ts`에 `@ApiProperty()` 붙은 클래스(예: `CampaignResponseDto`)를 별도로 두고 컨트롤러 메서드에 `common/response/api-envelope.decorator.ts`의 `ApiEnvelopedResponse(Model)`/`ApiEnvelopedPaginatedResponse(Model)`/`ApiEnvelopedEmptyResponse()`를 붙인다. 이 데코레이터들은 `ResponseInterceptor`가 모든 성공 응답을 감싸는 `{result, data}` 봉투(08_API_COMMON.md 1.4)까지 Swagger 스키마에 그대로 반영해준다 — 컨트롤러 메서드 자체의 반환 타입 어노테이션만으로는 `nest-cli` 플러그인이 `Object`로만 추론해(interface는 런타임 타입 정보가 없어서) 응답 스키마가 비어버리므로, 반드시 이 데코레이터를 명시적으로 붙여야 한다. 응답 셰이프가 상황에 따라 달라지는 드문 경우(예: `POST /v1/coupons/unconfirmed`)는 이 헬퍼 대신 `@ApiExtraModels`+`@ApiResponse`+`oneOf`를 직접 조합한다(`coupon-usage.controller.ts` 참고).

---

# 3. Stored Procedure / Function 컨벤션

## 3.1 네이밍

형식: `SP_도메인_동작`(Procedure) / `FN_설명`(Function) — **전부 대문자**로 작성해 Procedure/Function을 접두어로 구분한다.

```text
SP_CAMPAIGN_CREATE
SP_CAMPAIGN_UPDATE
SP_CAMPAIGN_APPROVE
SP_COUPON_RESERVE
SP_COUPON_CONFIRM

FN_CHECK_PROJECT_ACCESS
FN_CHECK_ROLE_LEVEL
```

- 도메인은 테이블/기능 단위(`CAMPAIGN`, `COUPON`, `USER` 등)
- 동작은 동사 위주로 짧게(`CREATE`/`UPDATE`/`APPROVE`/`RESERVE` 등)
- Function은 여러 도메인의 SP에서 공용으로 호출되는 경우가 많아 특정 도메인에 묶이지 않는 서술적 이름(`FN_설명`)을 쓴다
- 접두어뿐 아니라 저장 위치도 분리한다 — Procedure는 `database/procedures/`(개별 파일 + `all_procedures.sql` 통합본), Function은 `database/functions/`(개별 파일 + `all_functions.sql` 통합본)에 둔다(2026-07-19 폴더 분리). 동기화 원칙은 동일 — 개별 파일을 고치면 해당 통합 파일도 반드시 함께 갱신한다
- **로그 DB(`coupon_platform_log`) 전용 SP는 `database_log/procedures/`(개별 파일 + `all_procedures_log.sql` 통합본)에 별도로 둔다**(2026-07-20 신설, 예: `SP_LOG_AUDIT_CREATE`) — `database_log/tables/`가 메인 테이블과 물리적으로 분리돼 있는 것과 동일한 이유로, 로그 DB에서만 실행되는 SP도 메인 DB SP(`database/procedures/`)와 저장 위치를 분리한다. 메인 DB 산출물은 `database/`, 로그 DB 산출물은 `database_log/`로 최상위 폴더 자체를 나눈다(각각 `tables/`+`procedures/` 하위 구조). `LogSpExecutorService`(로그 DB 전용 커넥션 풀)만 이 폴더의 SP를 호출한다

## 3.2 권한 체크는 재사용 가능한 Function으로 분리

SP마다 반복되는 권한/스코핑 체크(예: "SUPER_ADMIN은 전체, 그 외는 `user_role`에 활성 배정된 `project_id`만")는 각 SP에 인라인으로 복붙하지 않고, 별도 Function으로 뽑아 호출한다.

```text
FN_IS_SUPER_ADMIN(user_id) RETURNS BOOLEAN
FN_CHECK_COMPANY_ACCESS(user_id, company_id) RETURNS BOOLEAN
FN_CHECK_PROJECT_ACCESS(user_id, project_id) RETURNS BOOLEAN
FN_GET_PROJECT_ROLE_CODE(user_id, project_id) RETURNS TINYINT UNSIGNED  -- 배정 없으면 NULL
```

- 권한 판단 로직이 바뀌면 이 Function들만 수정하면 되고, SP마다 흩어진 동일 로직을 일일이 찾아 고치지 않아도 된다
- `FN_IS_SUPER_ADMIN`은 `user_role`에 `role_code=10`인 활성 배정이 있는지 확인한다 — SUPER_ADMIN 전용 SP(예: `SP_COMPANY_CREATE`)가 호출자의 SUPER_ADMIN 여부를 DB에서 직접 재확인할 때 쓴다. 이 Function 자체가 SUPER_ADMIN 판별을 담당하므로, 다른 세 Function처럼 "role_code=10이면 건너뛴다" 우회 로직이 필요 없다 — 반환값을 그대로 권한 판단에 쓴다.
- `FN_CHECK_COMPANY_ACCESS`는 `user.company_id` 자체를 확인한다 — DEVELOPER의 회사 단위 스코핑(12_USER_API.md 1.1~1.3)처럼 프로젝트 배정과 무관하게 소속 회사만 맞으면 되는 경우에 쓴다.
- `FN_CHECK_PROJECT_ACCESS`는 "배정되어 있는가"만 boolean으로 답한다 — role_code 수준과 무관하게 배정 유무만 확인하면 되는 경우(예: 캠페인 등 쿠폰 도메인의 `SP_CAMPAIGN_LIST`처럼 MANAGER/OPERATOR를 포함한 모든 배정을 인정해야 하는 스코핑)에 쓴다. `FN_GET_PROJECT_ROLE_CODE`는 실제 role_code 값을 반환한다 — role_code의 **값에 따라 처리가 갈리거나 특정 등급 이상만 허용해야 하는** SP를 위한 것으로, `FN_CHECK_PROJECT_ACCESS(u,p)`는 `FN_GET_PROJECT_ROLE_CODE(u,p) IS NOT NULL`과 동치다. `FN_CHECK_COMPANY_ACCESS`/`FN_CHECK_PROJECT_ACCESS`/`FN_GET_PROJECT_ROLE_CODE`는 SUPER_ADMIN 우회를 책임지지 않는다 — 호출하는 SP가 `NOT FN_IS_SUPER_ADMIN(i_requester_user_id)`로 먼저 확인한 뒤에만 이 Function들을 호출한다(SUPER_ADMIN은 특정 회사/프로젝트에 매인 값이 아니라 이 Function들로 표현할 수 없다).
- **"배정 여부"와 "그 프로젝트에서의 role_code 등급"을 혼동하지 말 것**(2026-07-24 발견) — 프로젝트 관리메뉴(목록/상세/Secret 재발급)는 처음에 `FN_CHECK_PROJECT_ACCESS`(배정 존재 여부만)로 구현했다가, 이 프로젝트에서 OPERATOR(40)로만 배정된 사용자가 다른 프로젝트에서는 DEVELOPER(20)라 JWT의 MIN role_code가 20이면 관리메뉴 진입 자체는 허용되어 이 프로젝트까지 조회·재발급이 가능해지는 결함이 드러났다(10_COMPANY_API.md 1.2가 "프로젝트 관리메뉴는 DEVELOPER 이상 전용"이라고 규정하는데, 그 판단을 "이 프로젝트에서" 다시 해야 하는데 안 했던 것). `FN_GET_PROJECT_ROLE_CODE`로 실제 role_code를 가져와 `<= 20`까지 확인해야 하는 경우와, `FN_CHECK_PROJECT_ACCESS`로 배정 여부만 확인하면 되는 경우(예: 캠페인 도메인은 MANAGER/OPERATOR도 접근 가능하므로 배정 여부만 확인)를 SP 작성 시 반드시 구분한다 — "이 role_code 값이면 안 되는 하한선이 있는가"를 먼저 따져본다.
- **역할 검증이 필요한 모든 SP는 이 Function들 중 해당하는 것을 사용해 액션 처리 전에 검증한다**(2026-07-19 정책 확정) — 앱(TypeScript) 서비스 레이어가 이미 같은 판단을 하고 있더라도, SP도 호출자의 `i_requester_user_id`를 받아 동일한 검증을 반복한다(방어적 이중 체크: 앱 레이어 버그나 우회 호출에도 DB가 마지막 방어선이 되도록). SP는 호출자의 `role_code` 값 자체를 앱으로부터 전달받아 신뢰하지 않는다 — `FN_IS_SUPER_ADMIN`이 DB에서 직접 재확인하므로 별도 `i_requester_role` 파라미터가 필요 없다. 예: `SP_COMPANY_CREATE/LIST/GET_BY_ID/UPDATE`, `SP_PROJECT_CREATE/UPDATE`, `SP_USER_APPROVE/REJECT/UPDATE/PASSWORD_RESET`, `SP_USER_ROLE_CREATE/LIST/UPDATE`는 `FN_IS_SUPER_ADMIN`만으로, `SP_USER_LIST/GET_BY_ID`는 `FN_IS_SUPER_ADMIN` + `FN_CHECK_COMPANY_ACCESS`로, `SP_PROJECT_LIST/GET_BY_ID`·`SP_PROJECT_API_SECRET_ROTATE`는 `FN_IS_SUPER_ADMIN` + `FN_GET_PROJECT_ROLE_CODE(<=20 확인)`으로 재검증한다(`SP_PROJECT_API_SECRET_ROTATE`도 처음엔 앱이 전달한 `i_role_code`로 SUPER_ADMIN 우회를 판단했으나 2026-07-19 감사에서 이 정책 위반이 발견돼 나머지와 동일하게 통일됨; 세 SP 모두 2026-07-24 이전엔 회사 단위(`FN_CHECK_COMPANY_ACCESS`) 또는 배정 존재 여부(`FN_CHECK_PROJECT_ACCESS`)만 확인했으나, 위 항목의 결함이 드러나 role_code 등급까지 확인하는 `FN_GET_PROJECT_ROLE_CODE`로 최종 통일). 검증 실패 시 `PERMISSION_DENIED`(20001)를 반환한다.
- 캠페인/코드/사용이력 API([17_CAMPAIGN_API.md](./17_CAMPAIGN_API.md) 1.2 참고)처럼 여러 엔드포인트가 동일한 스코핑 규칙을 공유하는 경우 특히 중요하다
- **예외 — 로그 DB(`coupon_platform_log`) SP는 이 Function들을 쓸 수 없다.** 물리적으로 분리된 별도 DB라(1장) 메인 DB의 `user`/`user_role`을 참조하지 못해 `FN_IS_SUPER_ADMIN` 등을 호출할 방법이 없다. `SP_LOG_AUDIT_CREATE`(기록)는 이미 검증이 끝난 메인 도메인 SP 호출 이후에만 실행되는 내부 인프라 호출이라 문제가 없지만, `SP_LOG_AUDIT_LIST`/`GET_BY_ID`([13_LOG_AUDIT_API.md](./13_LOG_AUDIT_API.md) 5/6장, HTTP로 직접 노출되는 조회 API)는 이 예외 때문에 "방어적 이중 체크" 자체가 불가능하다 — 앱 레이어(`LogAuditService`)가 유일한 권한 판단 지점이 된다(2026-07-22).
- **로그 DB 조회 API가 project/campaign 단위 스코핑(캠페인 도메인 규칙)을 써야 하는 경우 — "메인 DB 접근권한 확인 → 로그 DB 목록 조회" 2단계 호출**(2026-07-22, [17_CAMPAIGN_API.md](./17_CAMPAIGN_API.md) 4.2/4.3). `log_audit`의 회사 단위 스코핑은 JWT의 `companyId`를 그대로 비교하면 끝나 쿼리가 필요 없었지만, 캠페인 도메인 스코핑(`user_role`에 실제 활성 배정된 `project_id`인지)은 메인 DB 조회 없이는 판단 자체가 불가능하다. 그렇다고 로그 DB SP가 이 체크를 할 수도 없으므로(바로 위 예외), 앱(TS) 레이어가 **먼저 메인 DB SP로 접근권한만 확인하고(통과 못하면 즉시 20001/31004, 로그 DB는 호출조차 하지 않음), 통과했을 때만 로그 DB SP로 실제 목록을 조회**하는 2단계 구조를 쓴다. 캠페인 하위 로그(`GET /campaigns/{id}/logs`)는 캠페인 도메인이 이미 갖고 있는 존재확인+스코핑 체크(`SP_CAMPAIGN_GET_BY_ID`와 동일 로직)를 재사용하면 되지만, 캠페인에 종속되지 않고 프로젝트 단위로만 스코핑되는 조회(`GET /coupon-use-logs`)는 "접근권한 확인만" 하는 전용 SP가 기존에 없어 신규로 만든다(`SP_PROJECT_CHECK_ACCESS`) — `SP_CAMPAIGN_LIST`가 `FN_CHECK_PROJECT_ACCESS`를 SP 안에서 바로 쓸 수 있는 것과 대비되는 지점(그건 `coupon_campaign`이 메인 DB에 있어서 가능한 것).
- **2단계 패턴의 변형 — boolean 접근권한이 아니라 "허용 목록 자체"를 필터로 넘기는 경우**(2026-07-24, [13_LOG_AUDIT_API.md](./13_LOG_AUDIT_API.md) 3장). 위 항목은 "특정 하나의 project_id에 접근권한이 있는가"를 확인해 통과/차단만 결정하지만, `log_audit` 목록 조회(`SP_LOG_AUDIT_LIST`)처럼 한 번의 호출에 여러 `project_id`가 섞여 나올 수 있는 페이지네이션 조회는 그 방식이 안 맞는다 — 대신 앱(TS) 레이어가 메인 DB SP(`SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS`)로 호출자가 `role_code<=20`으로 배정된 **프로젝트 ID 목록**(콤마 문자열)을 먼저 조회하고, 로그 DB SP 호출 시 이 문자열을 필터 파라미터로 그대로 전달해 `FIND_IN_SET`으로 SQL 단에서 걸러낸다. `NULL`(SUPER_ADMIN, 제한 없음)과 `''`(DEVELOPER이지만 배정된 프로젝트가 하나도 없음, 전부 제외)을 명확히 구분해야 한다 — `GROUP_CONCAT`이 빈 목록에 `NULL`을 반환하므로 앱 레이어가 이를 빈 문자열로 정규화하지 않으면 "제한 없음"으로 잘못 해석될 수 있다.

## 3.3 주석은 철저히

SP/Function 본문에는 **무엇을 하는지(what)뿐 아니라 왜 이렇게 처리하는지(why)**를 반드시 남긴다 — 특히 동시성 처리(조건부 UPDATE/갭락), 검증 순서, 부수효과가 있는 분기는 이유를 적어두지 않으면 나중에 왜 이렇게 짰는지 아무도 모른다. `database/tables/*.sql`의 테이블 DDL들이 이미 이 스타일(헤더 주석에 설계 이유 기록)로 작성돼 있으니, SP/Function 본문에도 동일한 수준으로 적용한다.

## 3.4 SP 결과 반환 규약 — OUT 파라미터 대신 RESULT SELECT

SP는 **OUT 파라미터를 쓰지 않는다** — mysql2는 `CALL sp(?, ?)`의 placeholder로 OUT 파라미터를 바인딩할 수 없어(MySQL 프로토콜 제약) 세션 변수(`SET @out; CALL ...; SELECT @out;`) 우회가 필요하고, 코드가 지저분해진다. 대신 아래 규약을 따른다.

- **첫 SELECT는 항상 `RESULT` 컬럼 하나만 있는 단일 행**이다(`08_API_COMMON.md`의 result 코드를 그대로 사용, 성공은 `0`)
- **성공(`RESULT=0`)일 때만 이어서 두 번째 SELECT로 실제 데이터**를 반환한다. 실패 시엔 두 번째 SELECT를 아예 실행하지 않는다 — NestJS 쪽은 항상 첫 result set의 `RESULT`부터 확인하고, `0`일 때만 두 번째 result set을 읽는다는 계약을 지킨다
  - **예외**: 호출부가 반환값 자체를 쓰지 않는 순수 로그 적재 SP(예: `SP_LOG_AUDIT_CREATE`, `LogSpExecutorService.logCall`이 호출)는 성공해도 두 번째 SELECT를 생략할 수 있다 — `sp-result.util.ts`의 `callStoredProcedure`가 두 번째 result set 부재를 `data: undefined`로 그냥 처리하므로 호출부가 깨지지 않는다(2026-07-20, `SP_LOG_AUDIT_CREATE` 도입 시 확정)
- **예측 가능한 비즈니스 실패**(코드 없음, 한도 초과 등)는 예외(`SIGNAL`)로 던지지 않고, 검증 실패 시점에 바로 `SELECT <해당 result 코드> AS RESULT`를 실행한 뒤 라벨 블록(`label: BEGIN ... LEAVE label; END;`)으로 빠져나간다 — 이건 정상적인 제어 흐름이지 예외 상황이 아니다
- **예측 못한 시스템 오류**(제약 위반, 데드락 등 SQL 자체의 예외)는 `DECLARE EXIT HANDLER FOR SQLEXCEPTION`으로 잡는다. 핸들러는 `ROLLBACK` 후 `GET DIAGNOSTICS`로 얻은 `SQLSTATE`/`MYSQL_ERRNO`/`MESSAGE_TEXT`를 `SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE`로 반환한다(`50001` = `08_API_COMMON.md`의 "데이터베이스 오류(SP 내부 오류)"). 이 진단 컬럼들은 API 응답에 그대로 노출하지 않고 서버 로그용으로만 사용한다
- **`SIGNAL SQLSTATE`도 별도 경로가 아니다** — SP/Function 내부 어딘가에서 `SIGNAL`로 명시적으로 예외를 던지더라도, 이는 `SQLEXCEPTION` 조건이라 위와 동일한 `EXIT HANDLER`에 그대로 잡혀 `RESULT`로 변환된다. 즉 예외가 엔진이 직접 낸 것이든(제약 위반 등) 코드 중간에 `SIGNAL`로 던진 것이든 최종적으로는 하나의 핸들러를 거쳐 동일한 형태로 응답된다 — SIGNAL 전용 처리 로직을 별도로 둘 필요가 없다
- 조건 검증 실패 시 얼리 리턴처럼 빠져나가기 위해 `label: BEGIN ... END;` 블록 + `LEAVE label` 패턴을 쓴다(중첩 IF/ELSE 대신)

```sql
CREATE PROCEDURE SP_COUPON_RESERVE(
    IN i_code_value    VARCHAR(50),
    IN i_project_id    BIGINT,
    IN i_game_user_id  VARCHAR(100)
)
BEGIN
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        -- ... 코드 존재 확인, 멱등 체크, 조건부 UPDATE 등 (06_COUPON_USAGE_SCENARIO.md 2장 참고)

        IF /* 코드 없음 */ THEN
            SELECT 31005 AS RESULT;
            LEAVE proc_block;
        END IF;

        -- ... 성공 처리(COMMIT) ...

        SELECT 0 AS RESULT;
        SELECT coupon_code_usage_id, code_value, game_user_id, reward_data, created_at
        FROM coupon_code_usage WHERE ...;
    END proc_block;
END
```

## 3.5 COMMENT 절 / 파라미터 주석

- 모든 SP는 파라미터 목록 다음에 `COMMENT '...'` 절로 한 줄 요약을 남긴다 — 테이블의 `COMMENT=` 절(`database/tables/*.sql`)과 같은 원칙으로, `SHOW CREATE PROCEDURE`/`information_schema.ROUTINES`만 조회해도 무엇을 하는 SP인지 바로 알 수 있어야 한다.
- 3.3에서 요구하는 상세 헤더 주석(명칭/작성일/내용/설계 이유)은 `CREATE PROCEDURE` **앞이 아니라 `BEGIN` 바로 다음 줄**에 둔다 — `CREATE PROCEDURE` 앞의 주석은 `.sql` 파일에만 존재하고 실제 저장된 루틴 본문에는 남지 않는다. `BEGIN` 아래에 두면 소스 파일 없이 `SHOW CREATE PROCEDURE`로 조회해도 설계 의도를 그대로 확인할 수 있다.
- `IN` 파라미터는 각 줄 끝에 무엇을 의미하는지 짧은 인라인 주석을 남긴다.
- `DROP PROCEDURE IF EXISTS ...;` / `DELIMITER $$` / `CREATE PROCEDURE ...` 세 줄은 빈 줄 없이 붙여쓴다(2026-07-19 스타일 확정).
- 파라미터 목록을 닫는 `)`와 그 뒤의 `COMMENT '...'`도 한 줄로 붙여쓴다(2026-07-19 스타일 확정).

```sql
DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_API_KEY`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_API_KEY` (
    IN i_api_key VARCHAR(64)  -- 조회할 API Key (project.api_key)
) COMMENT 'API Key로 project 조회 (S2S 인증 가드 전용, docs/07_AUTH_SECURITY.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_API_KEY
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : ... (3.3 기준의 상세 설계 이유)
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state CHAR(5) DEFAULT '00000';
    -- ...
END$$

DELIMITER ;
```

---

## 3.6 페이지네이션 목록 SP의 total_count 처리

목록 SP는 3.4의 "RESULT + data 정확히 2개 result set" 규약 때문에 `total_count`를 별도의 세 번째 result set으로 반환할 수 없다. **`COUNT(*) OVER()` 윈도우 함수를 data의 각 행에 얹는 방식은 쓰지 않는다** — 요청한 `offset`이 실제 데이터 범위를 벗어나 페이지네이션 대상 SELECT가 0행을 반환하면, `total_count`를 실어 보낼 행 자체가 없어져 항상 `0`으로 잘못 응답된다(2026-07-19 감사에서 `company`/`project`/`user`/`user_role` 4개 목록 SP 전부에서 이 버그가 발견됨).

대신 총 개수를 계산하는 서브쿼리와 페이지네이션 서브쿼리를 분리하고, `LEFT JOIN ... ON TRUE`로 붙인다 — 총 개수 서브쿼리는 항상 정확히 1행을 반환하므로, 페이지네이션 서브쿼리가 0행이어도 `LEFT JOIN`이 그 1행(데이터 컬럼은 전부 NULL, `total_count`만 채워짐)을 보존한다.

```sql
SELECT
    p.`company_id`, p.`company_name`, /* ... */,
    cnt.`total_count`
FROM (
    SELECT COUNT(*) AS total_count FROM `company` WHERE /* 동일 필터 */
) cnt
LEFT JOIN (
    SELECT `company_id`, `company_name` /* ... */
    FROM `company`
    WHERE /* 동일 필터 */
    ORDER BY /* ... */
    LIMIT i_page_size OFFSET i_offset
) p ON TRUE;
```

앱(TypeScript) 서비스 레이어는 이 "데이터 없음" 행을 PK 컬럼이 `NULL`인지로 판별해 `items`에서 제외하고, `total_count`는 그대로 읽는다(`rows[0]?.total_count ?? 0`은 그대로 유지 — data가 정말 빈 배열일 때의 방어 코드).

`SP_COMPANY_LIST`/`SP_PROJECT_LIST`/`SP_USER_LIST`/`SP_USER_ROLE_LIST`가 이 패턴을 쓴다. 캠페인/코드 목록 SP를 새로 만들 때도 동일하게 적용한다.

---

# 4. 동시성 처리 원칙

**동시성이 필요한 UPDATE는 조건부 갱신(conditional UPDATE)을 우선한다.** 체크 후 쓰기(check-then-act) 대신 WHERE절에 조건을 넣어 원자성을 확보한다(예: `coupon_code`/`coupon_campaign`).

- 개수 기반 한도 체크처럼 조건부 UPDATE로 해결이 안 되는 경우에만 `SELECT ... FOR UPDATE` 갭락을 쓴다
- UNSIGNED 오버플로 유도 같은 SQL 모드 의존적인 트릭은 쓰지 않는다(strict 모드가 아니면 조용히 값이 깨질 수 있음)

## 4.1 인스턴스(레플리카) 간 배치 중복 실행 방지

`node-cron`으로 등록하는 배치(`SessionCleanupService`/`ApiSecretCleanupService` 등)는 스케일아웃 환경에서 레플리카마다 각자 인메모리로 스케줄을 등록하므로, 별도 조치가 없으면 N개 레플리카가 같은 스케줄에 동시에 같은 배치를 중복 실행한다(스케일아웃 점검 3번, 2026-07-23). SP 자체가 멱등(DELETE/조건부 UPDATE)이라 정합성이 깨지지는 않지만, 레플리카 수만큼 불필요한 DB 왕복이 늘어난다.

**해결**: `SpExecutorService.runExclusive(lockName, fn)` — MySQL 세션 수준 advisory lock(`GET_LOCK`/`RELEASE_LOCK`, timeout=0 non-blocking)으로 감싸 한 시점에 한 레플리카만 실제로 `fn`을 실행하도록 한다. Redis 등 별도 분산 락 인프라를 새로 들이지 않고 이미 쓰고 있는 MySQL만으로 해결한 것 — `GET_LOCK`은 락을 커넥션 세션에 묶어 관리하므로 반드시 pool에서 커넥션 하나를 직접 뽑아 잡고 있어야 하고(`callProcedure`처럼 매 호출마다 pool이 임의로 골라주는 커넥션으로는 락을 건 커넥션과 푸는 커넥션이 달라질 수 있음), timeout=0으로 시도해 이미 다른 레플리카가 실행 중이면 대기 없이 즉시 포기한다(크론은 다음 스케줄에 또 돌아오므로 기다릴 이유가 없음).

`GET_LOCK`/`RELEASE_LOCK`은 도입 당시(2026-07-23) `SpExecutorService`가 `conn.query('SELECT GET_LOCK(?, 0) AS acquired', ...)`로 raw SQL을 직접 호출했다 — 이 프로젝트의 "ORM/Native SQL 직접 작성 금지, SP 전용" 정책(01_TECH_STACK.md)의 유일한 예외였다. 운영 DB 계정을 SP 실행(EXECUTE) 권한만 허용하는 모델로 굳힐 계획이 확정되면서(2026-07-26) 이 raw SQL이 실제로 실행 불가능해질 수 있다는 게 드러나, `SP_LOCK_ACQUIRE`/`SP_LOCK_RELEASE`(`database/procedures/`) 2개로 감쌌다 — `CALL SP_LOCK_ACQUIRE(?)`/`CALL SP_LOCK_RELEASE(?)`도 여전히 `runExclusive`가 붙잡고 있는 동일 커넥션 위에서 호출해야 하는 제약은 그대로다(SP로 감싼다고 세션 종속성이 사라지지 않음). 두 SP 모두 특정 도메인에 속하지 않는 인프라 전용이라 `SP_LOCK_ACQUIRE`/`SP_LOCK_RELEASE`처럼 `LOCK`을 도메인처럼 취급하는 이름을 쓴다.

**새로 크론 배치를 추가할 때는 이 패턴을 그대로 재사용한다** — `SP_SESSION_CLEANUP`/`SP_PROJECT_API_SECRET_CLEANUP`/`SP_NONCE_CLEANUP`(`NonceCleanupService`, 스케일아웃 점검 4번, 2026-07-23 뒤늦게 구현 완료)/`SP_CAMPAIGN_CODE_GENERATION_STALE_LIST`(`CodeGenerationStaleMonitorService`, 스케일아웃 점검 5번)/`SP_CAMPAIGN_EXPIRE`(`CampaignExpiryService`, 2026-07-25)까지 5개 크론 배치 전부 이미 이렇게 감싸져 있다.

**현재 등록된 크론 배치 5개**(전부 `OnModuleInit`에서 등록, `runExclusive`로 스케일아웃 중복실행 방지, `OnModuleDestroy`로 정상 종료 시 정지 — 바로 아래 항목 참고):

| 서비스(`common/`)                     | SP                                        | 스케줄 env(기본값)                                 | 무엇을 정리/처리하는가                                                                                      | 비고                                                                                                    |
| -------------------------------------- | ------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `SessionCleanupService`                | `SP_SESSION_CLEANUP`                       | `SESSION_CLEANUP_CRON`(매일 04:00)                   | 만료된 `user_session` 행을 **물리 삭제**한다                                                                  | JWT 인증 자체는 세션 존재 여부로 매 요청마다 검증되므로, 이 배치가 늦게 돌아도 만료된 세션으로 인증이 통과하는 일은 없다(순수 정리용, 정합성과 무관) |
| `ApiSecretCleanupService`              | `SP_PROJECT_API_SECRET_CLEANUP`            | `API_SECRET_CLEANUP_CRON`(매일 05:00)                | `API_SECRET_GRACE_PERIOD_DAYS`(기본 7일)가 지난 `project.api_secret_prev`를 **NULL로 초기화**한다             | Secret 재발급 시 이전 값을 유예기간 동안 `api_secret_prev`에 남겨 신·구 Secret 둘 다로 S2S 서명을 검증하다가(`S2sAuthGuard.verifySignature`), 유예기간이 끝나면 이 배치가 옛 값을 지운다 |
| `NonceCleanupService`                  | `SP_NONCE_CLEANUP`                         | `S2S_NONCE_CLEANUP_CRON`(10분마다)                   | `S2S_TIMESTAMP_TOLERANCE_SEC`(기본 300초)보다 오래된 `project_api_nonce` 행을 **물리 삭제**한다                | S2S HMAC 재전송 방지용 nonce 기록 테이블. reserve/confirm 트래픽이 많으면 다른 배치보다 훨씬 빠르게 쌓여서 5개 중 스케줄이 가장 잦다 |
| `CodeGenerationStaleMonitorService`    | `SP_CAMPAIGN_CODE_GENERATION_STALE_LIST`   | `CODE_GENERATION_STALE_MONITOR_CRON`(5분마다)        | **정리하지 않는다** — `generation_status=2`(진행중)에서 정체된 RANDOM 코드생성 job을 감지만 하고 전용 로그 파일(`logs/code-generation-stale.log`)에 경고만 남긴다 | 5개 중 유일하게 DB를 변경하지 않는 서비스(감지 전용). 자동 복구는 의도적으로 하지 않기로 결정했고(2026-07-21), 관리자가 직접 `POST /campaigns/{id}/codes/abort`로 복구해야 한다 |
| `CampaignExpiryService`                | `SP_CAMPAIGN_EXPIRE`                       | `CAMPAIGN_EXPIRY_CRON`(5분마다)                      | 사용기간(`campaign_end`)이 지났는데 아직 활성(`status=2`)+승인불요·승인완료(`approval_status` 1 또는 3)인 캠페인을 **종료(`status=4`)로 자동 전환**한다 | 물리 삭제가 아니라 상태 전환. `log_coupon_campaign`에 사람이 아니라 배치가 한 액션임을 남기는 `created_by=0`/`created_by_name='SYSTEM'` sentinel 규칙(4.2절)을 이 프로젝트에서 처음 도입한 배치 |

### 서버 정상 종료 시 크론 스케줄도 반드시 멈춰야 한다(2026-07-26)

`main.ts`는 스케일아웃 점검(2026-07-23) 때 `app.enableShutdownHooks()`를 이미 추가해, SIGTERM 수신 시 `SpExecutorService`/`LogSpExecutorService`의 `onModuleDestroy`(mysql2 pool `end()`)가 호출되도록 해뒀다. 하지만 위 5개 크론 서비스는 전부 `OnModuleInit`에서 `cron.schedule(...)`만 호출하고 그 반환값(`ScheduledTask`)을 어디에도 저장하지 않아, `OnModuleDestroy`로 스케줄 자체를 멈출 방법이 없었다 — DB pool은 먼저 정리되는데 아직 살아있는 크론 스케줄이 그 사이에 발동하면 "Pool is closed" 에러가 난다. 이 결함은 실제 운영 SIGTERM 그레이스풀 셧다운에서도 동일하게 재현될 수 있었지만, 지금까지 수동 스모크 테스트로만 검증해와서 드러나지 않고 있었다 — E2E 테스트 스위트를 처음 실제 로컬 DB로 돌려본 뒤(`npm run test:e2e`가 매 실행마다 `app.close()`를 호출하는 여러 Nest 앱 인스턴스를 짧은 시간에 만들고 정리하는 과정에서) 로그에 "Pool is closed" 에러가 남는 것을 보고 처음 발견됐다.

**해결**: 5개 서비스 전부 `OnModuleDestroy`를 구현 — `cron.schedule()`의 반환값을 `private task: ScheduledTask | undefined` 필드에 저장해두고, `onModuleDestroy`에서 `await this.task?.stop()`으로 멈춘다. `node-cron` 4.6.0이 자체 번들 타입(`node_modules/node-cron/dist/node-cron.d.ts`)에서 `stop(): void | Promise<void>`로 선언해뒀다 — 실행 중인 job이 있으면 그 완료를 기다렸다 멈출 수 있다는 뜻이라, `onModuleDestroy` 자체를 `async`로 선언하고 `void` 캐스팅으로 얼버무리지 않고 제대로 `await`해야 한다(eslint `no-floating-promises`도 이 타입을 보고 정확히 그 지점을 잡아낸다).

이 수정은 코드 자체는 5개 파일 각각 몇 줄씩이라 사소해 보이지만, **정상 종료 훅은 "DB 연결을 정리하는 것"과 "그 DB 연결을 계속 쓰려는 백그라운드 작업을 먼저 멈추는 것" 두 가지를 항상 짝으로 갖춰야 한다**는 일반 원칙을 보여준다 — 스케일아웃 점검 때는 전자만 다루고 후자를 놓쳤었다. 앞으로 새로 추가하는 크론 배치도 `OnModuleInit`에서 `cron.schedule()`의 반환값을 반드시 필드에 저장하고 `OnModuleDestroy`에서 `stop()`해야 한다 — 이 패턴을 빠뜨리면 겉보기엔 정상 동작하다가 배포/재시작 타이밍에만 드물게 에러 로그가 남는, 알아채기 어려운 결함이 된다.

## 4.2 배치가 도메인 로그에 남기는 "시스템 행위자"

`log_audit`/`log_coupon_campaign` 같은 도메인 변경이력 테이블은 지금까지 항상 "실제로 그 액션을 수행한 사람"(`created_by`/`created_by_name`)을 전제로 설계돼 있었다 — 그런데 `SP_CAMPAIGN_EXPIRE`(사용기간 만료 자동 종료, 2026-07-25)처럼 **사람이 아니라 배치가 직접 도메인 행을 변경**하는 경우가 처음 생기면서, 행위자 컬럼에 무엇을 넣을지 정할 필요가 생겼다.

**결정**: `created_by=0`(실제 `user.user_id`는 AUTO_INCREMENT라 1부터 시작하므로 0은 항상 안전한 sentinel) + `created_by_name='SYSTEM'`을 그대로 채운다. 이 값들은 사람이 남긴 다른 로그 행과 완전히 동일한 컬럼/조회 경로를 타므로, 화면(예: 캠페인 변경이력)에도 별도 분기 없이 "작업자: SYSTEM"으로 자연스럽게 노출된다.

- 로그 테이블은 `created_by`에 FK를 걸지 않는 원칙(1장 "로깅 원칙")이라 0을 넣어도 제약 위반이 없다 — 컬럼을 nullable로 바꾸는 스키마 변경 없이 해결한 이유
- 배치가 바꾸는 원본 도메인 테이블(`coupon_campaign` 등)의 `updated_by`는 이 sentinel을 쓰지 않고 그냥 `NULL`로 남긴다 — 이 컬럼은 애초부터 nullable이라(관리 콘솔 CREATE 시점처럼 특정 행위자가 없는 경우가 이미 있었음) 별도 관례가 필요 없다. sentinel이 필요한 건 로그 테이블의 행위자 컬럼(`created_by`)이 `NOT NULL`인 경우뿐이다
- **앞으로 사람 없이 배치가 직접 도메인 로그를 남겨야 하는 경우 이 sentinel(`0`/`'SYSTEM'`)을 그대로 재사용한다** — 배치마다 제각각 다른 sentinel을 정의하지 않는다

---

# 5. 멱등성 원칙

**재시도 가능한 쓰기 API(특히 S2S)는 멱등하게 설계한다** — 네트워크 타임아웃 등으로 응답이 유실돼 같은 요청이 여러 번 도달해도, 두 번째 이후 호출은 부작용을 중복시키지 않고 최초 성공과 동일한 결과를 반환해야 한다. 동시성 원칙(4장)이 "동시에 들어온 요청들을 안전하게 직렬화"하는 것이라면, 멱등성은 "같은 요청이 반복돼도 결과가 달라지지 않게" 하는 것으로 서로 다른 문제다 — 둘 다 재화(쿠폰) 관련 API에서는 기본으로 갖춰야 한다.

- 처리 전에 **이미 처리된 기존 결과가 있는지 먼저 확인**하고, 있으면 새로 만들지 않고 그 결과를 그대로 재반환한다(체크 후 진행이 아니라, "이미 끝난 요청인지" 확인이 잠금/생성보다 앞선다는 뜻)
- 멱등 판단 키(예: `coupon_code_usage`의 `(coupon_code_id, game_user_id)`)가 **하나의 논리적 요청을 유일하게 식별할 수 있을 때만** 적용한다 — 같은 키로 정당하게 여러 번 호출되는 경우(예: `use_limit_per_user>1`인 FIXED 코드의 반복 사용)까지 있으면 재시도와 정당한 반복을 구분할 수 없으므로, 이 경우엔 억지로 멱등 처리하지 않고 한계로 남긴다(클라이언트가 시도마다 별도 식별자를 보내야 완전히 해결되는데, 현재 스펙엔 그런 식별자가 없음)
- 구체적인 사례: [06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md) 1.2(reserve 멱등성), [18_COUPON_USAGE_API.md](./18_COUPON_USAGE_API.md) 2.2(confirm 멱등성)

---

# 6. 소스코드 주석 규칙

**모든 소스코드(TypeScript 백엔드/프론트엔드 전체)는 클래스/메서드/함수에 JSDoc 형식(`/** ... */`) 주석을 작성한다.**

- 무엇을 하는지뿐 아니라, 비자명한 경우 왜 이렇게 처리하는지도 함께 남긴다(3.3의 SP/Function 주석 원칙과 같은 정신을 TypeScript 코드에도 동일하게 적용)
- 클래스 상단에는 그 클래스의 책임과, 관련 설계 문서(예: `07_AUTH_SECURITY.md` 2.4)를 함께 적어 어떤 스펙을 구현한 코드인지 바로 추적할 수 있게 한다
- 인터페이스/타입 선언도 필드의 의미가 이름만으로 분명하지 않으면 JSDoc으로 보충한다
- 파일마다 최상단 JSDoc(클래스가 있으면 클래스 doc, 없으면 파일의 대표 export)에 `@author trisakion` 태그를 남긴다
- SQL(SP/Function)은 JSDoc 문법 자체가 없으므로 이 규칙의 대상이 아니다 — SQL 주석은 3.3(SP/Function 컨벤션의 주석 규칙)을 따르고, 개별 파일과 통합 파일(Procedure는 `all_procedures.sql`, Function은 `all_functions.sql`) 양쪽에 동일한 주석을 빠짐없이 유지한다(`all_tables.sql`이 개별 테이블 파일의 헤더 주석을 그대로 유지하는 것과 동일한 원칙)

# 7. TypeScript 에러 처리 — ERROR_MAP + BusinessException

**모든 예측 가능한 비즈니스 실패는 result 코드, 사용자 메시지, HTTP status를 한 곳(`common/response/error-map.ts`)에서만 관리하고, 커스텀 예외(`BusinessException`) 하나로 던진다.** 코드/메시지/상태코드가 파일마다 흩어져 따로 관리되는 걸 막기 위함이다 — 새 오류를 추가하거나 메시지를 바꿀 때 `error-map.ts` 한 파일만 고치면 된다.

```ts
// error-map.ts — ResultCode 하나당 {message, httpStatus} 한 쌍
export const ERROR_MAP: Record<ResultCode, ErrorEntry> = {
  [ResultCode.PROJECT_NOT_FOUND]: { message: '존재하지 않는 프로젝트입니다.', httpStatus: 404 },
  // ...
};

// business.exception.ts — result 코드만 넘기면 메시지/상태코드가 ERROR_MAP에서 자동으로 채워진다
throw new BusinessException(ResultCode.PROJECT_NOT_FOUND);
```

- HTTP status를 새로 정할 때는 08_API_COMMON.md 1.3 매핑 규칙(10000번대→401, 20000번대→403, 31000~31999→404, 그 외 30000번대→400, 40000번대→429, 50000번대→500)을 따른다
- `HttpExceptionFilter`(전역 예외 필터)가 `BusinessException`은 그대로, NestJS 기본 예외(ValidationPipe 등)와 미분류 예외는 별도 규칙으로 `{result, message}` 형태로 정규화해 응답한다 — 08_API_COMMON.md 1.5 "비즈니스 오류를 HTTP 200으로 반환하지 않는다" 원칙의 실제 구현체

### SP 시스템 오류(RESULT=50001)는 DB 접근 레이어에서 한 번만 처리한다

`SpExecutorService.callProcedure`(→ 내부적으로 `sp-result.util.ts`의 `callStoredProcedure`)가 SP의 RESULT=50001을 감지하면 그 자리에서 즉시 `BusinessException(ResultCode.DATABASE_ERROR)`을 던진다 — 값으로 반환하지 않는다. 이렇게 하면:

- 서비스/가드 코드는 SP가 정의한 **특정 비즈니스 코드만** 신경 쓰면 된다(`if (result !== 0) throw 비즈니스에러` 패턴이 안전해짐 — 50001이 그 분기에 절대 도달하지 않으므로)
- 호출부마다 "혹시 50001 아닌가"를 따로 확인할 필요가 없어, 그 확인이 누락되어 시스템 오류가 엉뚱한 비즈니스 실패(예: 로그인 실패, 세션 무효)로 잘못 분류되는 사고를 원천 차단한다(2026-07-19 리뷰에서 이 누락 패턴이 여러 곳에서 발견된 뒤 도입)
- 로그 적재처럼 실패를 절대 밖으로 던지면 안 되는 곳(`LogSpExecutorService.logCall`)은 이 예외를 그냥 try/catch로 잡아 삼키면 되므로 호환에 문제없다

**예외(2026-07-21 추가)**: `BusinessException`은 던져질 때 `sqlDiagnostics`(`{sqlState, errorNo}`)를 함께 실을 수 있다 — HTTP 응답 바디(`{result, message}`)에는 절대 포함되지 않고, 예외 인스턴스 자체에만 붙어 있다. 이건 위 원칙(호출부는 특정 비즈니스 코드만 신경 쓴다)을 깨는 게 아니라, "재시도 가능한 시스템 오류인지"까지 스스로 판단해야 하는 극히 드문 내부 호출부(코드 발급 백그라운드 루프의 `CampaignCodeService.generateRandomCodes` — `05_COUPON_ISSUANCE_SCENARIO.md` 2.2 "재시도 가능 에러만 대상, 4xx류 등은 즉시 실패 처리")를 위해 열어둔 좁은 탈출구다. 대부분의 호출부는 여전히 `if (result !== 0) throw` 패턴만으로 충분하고 이 필드를 알 필요가 없다.

# 8. 의존성 버전 관리

**`package.json`의 모든 의존성(dependencies/devDependencies)은 `^`/`~` 없이 특정 버전으로 고정한다.** 안정성과 모듈간 충돌 방지가 목적이다 — 세만틱 버전 범위(`^11.0.1` 등)는 `npm install` 시점마다 팀원/배포 환경마다 실제 설치되는 버전이 달라질 수 있어, 같은 커밋인데도 재현이 안 되는 문제가 생긴다.

- 새 패키지를 추가할 때는 `npm install <pkg>`로 설치한 뒤, `package-lock.json`에 실제로 resolve된 버전을 확인해 `package.json`에 그 정확한 버전 문자열(`^`/`~` 제거)을 반영한다
- 버전을 올릴 때도 범위를 넓혀두는 대신, 그 시점에 검증한 정확한 버전으로 다시 고정한다

# 9. 관련 문서

- DB 접근 정책(mysql2, SP 전용): [01_TECH_STACK.md](./01_TECH_STACK.md)
- 테이블별 특징/공통 정책: [04_DATABASE_SCHEMA.md](./04_DATABASE_SCHEMA.md)
- 쿠폰 사용(reserve/confirm) 멱등/동시성 설계 근거: [06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md)
