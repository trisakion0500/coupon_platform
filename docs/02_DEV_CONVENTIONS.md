# 02_DEV_CONVENTIONS.md

# 개발 컨벤션

실제 코드를 작성할 때 따르는 컨벤션을 모아둔 문서다. 프로젝트 설계 배경/의사결정 과정 같은 협업 방식 규칙은 여기 포함하지 않는다(리포에 커밋되지 않는 로컬 `CLAUDE.md`에서 관리).

---

# 1. 로깅 원칙

`log_audit`/`log_coupon_campaign`/`log_coupon_use` 등 로그 테이블은 **메인 서비스 DB와 물리적으로 별도인 DB에 둔다** — "향후 분리될 수도 있다"는 가능성이 아니라 확정된 전제이며, 2026.07.19부터 **로컬 개발 환경에서도** 실제로 분리되어 있다(`coupon_platform`=메인, `coupon_platform_log`=로그 전용 DB). DDL은 `database_log/tables/`(개별 파일 + `all_log_tables.sql` 통합본)에 있고, `database/tables/all_tables.sql`에는 더 이상 포함되지 않는다 — 메인 DB용 `database/`와 로그 DB용 `database_log/`를 별도 최상위 폴더로 분리해 물리적 DB 분리를 폴더 구조에서도 드러낸다. 접속 계정은 메인 DB와 같을 수도, 다를 수도 있어(운영 환경에서는 별도 계정일 가능성이 높음) 환경변수를 따로 관리한다(`LOG_DB_HOST`/`LOG_DB_PORT`/`LOG_DB_USER`/`LOG_DB_PASSWORD`/`LOG_DB_NAME`, `01_TECH_STACK.md` 참고). 과거 로그 적재 문제로 DB 전체가 장애를 겪은 경험 때문에, 로그가 안 쌓이는 상황이 오더라도 메인 트랜잭션(쿠폰 발급/사용 등 핵심 기능)은 절대 실패하면 안 된다.

- 로그 테이블에 FK를 걸지 않는다(물리적으로 분리된 DB는 FK로 묶을 수 없음)
- 로그 조회에 필요한 참조 정보는 조인 없이 볼 수 있도록 스냅샷 컬럼(예: `created_by_name`)으로 미리 비정규화해둔다
- **로그 기록은 메인 트랜잭션과 같은 DB 커넥션/트랜잭션에 절대 묶이지 않는다** — 물리적으로 다른 DB라 애초에 같은 트랜잭션으로 묶을 수도 없다(분산 트랜잭션/XA 사용 안 함). 메인 SP가 커밋된 뒤 별도 커넥션으로 로그 기록을 시도하고, 그 시도가 실패해도 메인 트랜잭션을 재시도·롤백시키지 않는다(강한 결합 금지) — 백엔드에서는 `SpExecutorService`(메인 DB)와 별개인 `LogSpExecutorService`(로그 DB, 별도 커넥션 풀)로 이 원칙을 구조적으로 강제한다

---

# 2. 코드 모듈화 원칙

- **두 번 이상 중복되는 코드는 모듈화한다**: 동일하거나 사소한 차이만 있는 로직이 두 곳 이상에서 쓰이게 되면 공통 함수/모듈로 분리한다.
- **개발 초기에 자주 쓰일 공통 기능은 먼저 모듈화한다**: DB 커넥션(mysql2 풀 획득/해제, SP 호출 래퍼), 공통 응답 포맷(result/data) 빌더, S2S 인증 가드 등 프로젝트 전반에서 반복 호출될 인프라성 기능은 개별 도메인 로직을 만들기 전에 먼저 공통 모듈로 정리해둔다.

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
- `FN_CHECK_COMPANY_ACCESS`는 `user.company_id` 자체를 확인한다 — DEVELOPER의 회사 단위 스코핑(11_PROJECT_API.md 2.2/2.3, 12_USER_API.md 1.1~1.3)처럼 프로젝트 배정과 무관하게 소속 회사만 맞으면 되는 경우에 쓴다.
- `FN_CHECK_PROJECT_ACCESS`는 "배정되어 있는가"만 boolean으로 답한다(11_PROJECT_API.md 2.5 Secret 재발급처럼 배정 여부만 확인하면 되는 경우). `FN_GET_PROJECT_ROLE_CODE`는 실제 role_code 값을 반환한다 — role_code의 **값에 따라 처리가 갈리는**(예: MANAGER 이하는 즉시 처리, OPERATOR는 승인대기로 전환, [17_CAMPAIGN_API.md](./17_CAMPAIGN_API.md)) SP를 위한 것으로, `FN_CHECK_PROJECT_ACCESS(u,p)`는 `FN_GET_PROJECT_ROLE_CODE(u,p) IS NOT NULL`과 동치다. `FN_CHECK_COMPANY_ACCESS`/`FN_CHECK_PROJECT_ACCESS`/`FN_GET_PROJECT_ROLE_CODE`는 SUPER_ADMIN 우회를 책임지지 않는다 — 호출하는 SP가 `NOT FN_IS_SUPER_ADMIN(i_requester_user_id)`로 먼저 확인한 뒤에만 이 Function들을 호출한다(SUPER_ADMIN은 특정 회사/프로젝트에 매인 값이 아니라 이 Function들로 표현할 수 없다).
- **역할 검증이 필요한 모든 SP는 이 Function들 중 해당하는 것을 사용해 액션 처리 전에 검증한다**(2026-07-19 정책 확정) — 앱(TypeScript) 서비스 레이어가 이미 같은 판단을 하고 있더라도, SP도 호출자의 `i_requester_user_id`를 받아 동일한 검증을 반복한다(방어적 이중 체크: 앱 레이어 버그나 우회 호출에도 DB가 마지막 방어선이 되도록). SP는 호출자의 `role_code` 값 자체를 앱으로부터 전달받아 신뢰하지 않는다 — `FN_IS_SUPER_ADMIN`이 DB에서 직접 재확인하므로 별도 `i_requester_role` 파라미터가 필요 없다. 예: `SP_COMPANY_CREATE/LIST/GET_BY_ID/UPDATE`, `SP_PROJECT_CREATE/UPDATE`, `SP_USER_APPROVE/REJECT/UPDATE/PASSWORD_RESET`, `SP_USER_ROLE_CREATE/LIST/UPDATE`는 `FN_IS_SUPER_ADMIN`만으로, `SP_PROJECT_LIST/GET_BY_ID`·`SP_USER_LIST/GET_BY_ID`·`SP_PROJECT_API_SECRET_ROTATE`는 `FN_IS_SUPER_ADMIN`(SUPER_ADMIN 우회) + `FN_CHECK_COMPANY_ACCESS`/`FN_CHECK_PROJECT_ACCESS`(그 외 스코핑)로 재검증한다(`SP_PROJECT_API_SECRET_ROTATE`도 처음엔 앱이 전달한 `i_role_code`로 SUPER_ADMIN 우회를 판단했으나 2026-07-19 감사에서 이 정책 위반이 발견돼 나머지와 동일하게 통일됨). 검증 실패 시 `PERMISSION_DENIED`(20001)를 반환한다.
- 캠페인/코드/사용이력 API([17_CAMPAIGN_API.md](./17_CAMPAIGN_API.md) 1.2 참고)처럼 여러 엔드포인트가 동일한 스코핑 규칙을 공유하는 경우 특히 중요하다

## 3.3 주석은 철저히

SP/Function 본문에는 **무엇을 하는지(what)뿐 아니라 왜 이렇게 처리하는지(why)**를 반드시 남긴다 — 특히 동시성 처리(조건부 UPDATE/갭락), 검증 순서, 부수효과가 있는 분기는 이유를 적어두지 않으면 나중에 왜 이렇게 짰는지 아무도 모른다. `database/tables/*.sql`의 테이블 DDL들이 이미 이 스타일(헤더 주석에 설계 이유 기록)로 작성돼 있으니, SP/Function 본문에도 동일한 수준으로 적용한다.

## 3.4 SP 결과 반환 규약 — OUT 파라미터 대신 RESULT SELECT

SP는 **OUT 파라미터를 쓰지 않는다** — mysql2는 `CALL sp(?, ?)`의 placeholder로 OUT 파라미터를 바인딩할 수 없어(MySQL 프로토콜 제약) 세션 변수(`SET @out; CALL ...; SELECT @out;`) 우회가 필요하고, 코드가 지저분해진다. 대신 아래 규약을 따른다.

- **첫 SELECT는 항상 `RESULT` 컬럼 하나만 있는 단일 행**이다(`08_API_COMMON.md`의 result 코드를 그대로 사용, 성공은 `0`)
- **성공(`RESULT=0`)일 때만 이어서 두 번째 SELECT로 실제 데이터**를 반환한다. 실패 시엔 두 번째 SELECT를 아예 실행하지 않는다 — NestJS 쪽은 항상 첫 result set의 `RESULT`부터 확인하고, `0`일 때만 두 번째 result set을 읽는다는 계약을 지킨다
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

# 8. 의존성 버전 관리

**`package.json`의 모든 의존성(dependencies/devDependencies)은 `^`/`~` 없이 특정 버전으로 고정한다.** 안정성과 모듈간 충돌 방지가 목적이다 — 세만틱 버전 범위(`^11.0.1` 등)는 `npm install` 시점마다 팀원/배포 환경마다 실제 설치되는 버전이 달라질 수 있어, 같은 커밋인데도 재현이 안 되는 문제가 생긴다.

- 새 패키지를 추가할 때는 `npm install <pkg>`로 설치한 뒤, `package-lock.json`에 실제로 resolve된 버전을 확인해 `package.json`에 그 정확한 버전 문자열(`^`/`~` 제거)을 반영한다
- 버전을 올릴 때도 범위를 넓혀두는 대신, 그 시점에 검증한 정확한 버전으로 다시 고정한다

# 9. 관련 문서

- DB 접근 정책(mysql2, SP 전용): [01_TECH_STACK.md](./01_TECH_STACK.md)
- 테이블별 특징/공통 정책: [04_DATABASE_SCHEMA.md](./04_DATABASE_SCHEMA.md)
- 쿠폰 사용(reserve/confirm) 멱등/동시성 설계 근거: [06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md)
