# 02_DEV_CONVENTIONS.md

# 개발 컨벤션

실제 코드를 작성할 때 따르는 컨벤션을 모아둔 문서다. 프로젝트 설계 배경/의사결정 과정 같은 협업 방식 규칙은 여기 포함하지 않는다(리포에 커밋되지 않는 로컬 `CLAUDE.md`에서 관리).

---

# 1. 로깅 원칙

`log_audit`/`log_coupon_campaign`/`log_coupon_use` 등 로그 테이블은 **실 운영 환경에서 메인 서비스 DB와 물리적으로 별도인 VM/DB(별도 서비스)에 둔다** — "향후 분리될 수도 있다"는 가능성이 아니라 확정된 전제다. `database/tables/all_tables.sql`에 다른 테이블과 함께 묶여 있는 것은 로컬 개발 편의를 위한 것일 뿐, 실제 배포 시 로그 테이블 DDL은 별도 DB 인스턴스에 적용한다. 과거 로그 적재 문제로 DB 전체가 장애를 겪은 경험 때문에, 로그가 안 쌓이는 상황이 오더라도 메인 트랜잭션(쿠폰 발급/사용 등 핵심 기능)은 절대 실패하면 안 된다.

- 로그 테이블에 FK를 걸지 않는다(물리적으로 분리된 DB는 FK로 묶을 수 없음)
- 로그 조회에 필요한 참조 정보는 조인 없이 볼 수 있도록 스냅샷 컬럼(예: `created_by_name`)으로 미리 비정규화해둔다
- **로그 기록은 메인 트랜잭션과 같은 DB 커넥션/트랜잭션에 절대 묶이지 않는다** — 물리적으로 다른 DB라 애초에 같은 트랜잭션으로 묶을 수도 없다(분산 트랜잭션/XA 사용 안 함). 메인 SP가 커밋된 뒤 별도 커넥션으로 로그 기록을 시도하고, 그 시도가 실패해도 메인 트랜잭션을 재시도·롤백시키지 않는다(강한 결합 금지)

---

# 2. 코드 모듈화 원칙

- **두 번 이상 중복되는 코드는 모듈화한다**: 동일하거나 사소한 차이만 있는 로직이 두 곳 이상에서 쓰이게 되면 공통 함수/모듈로 분리한다.
- **개발 초기에 자주 쓰일 공통 기능은 먼저 모듈화한다**: DB 커넥션(mysql2 풀 획득/해제, SP 호출 래퍼), 공통 응답 포맷(result/data) 빌더, S2S 인증 가드 등 프로젝트 전반에서 반복 호출될 인프라성 기능은 개별 도메인 로직을 만들기 전에 먼저 공통 모듈로 정리해둔다.

---

# 3. Stored Procedure / Function 컨벤션

## 3.1 네이밍

형식: `USP_도메인_동작`(Procedure) / `FN_설명`(Function) — **전부 대문자**로 작성해 Procedure/Function을 접두어로 구분한다.

```text
USP_CAMPAIGN_CREATE
USP_CAMPAIGN_UPDATE
USP_CAMPAIGN_APPROVE
USP_COUPON_RESERVE
USP_COUPON_CONFIRM

FN_CHECK_PROJECT_ACCESS
FN_CHECK_ROLE_LEVEL
```

- 도메인은 테이블/기능 단위(`CAMPAIGN`, `COUPON`, `USER` 등)
- 동작은 동사 위주로 짧게(`CREATE`/`UPDATE`/`APPROVE`/`RESERVE` 등)
- Function은 여러 도메인의 SP에서 공용으로 호출되는 경우가 많아 특정 도메인에 묶이지 않는 서술적 이름(`FN_설명`)을 쓴다

## 3.2 권한 체크는 재사용 가능한 Function으로 분리

SP마다 반복되는 권한/스코핑 체크(예: "SUPER_ADMIN은 전체, 그 외는 `user_role`에 활성 배정된 `project_id`만")는 각 SP에 인라인으로 복붙하지 않고, 별도 Function으로 뽑아 호출한다.

```text
FN_CHECK_PROJECT_ACCESS(user_id, project_id) RETURNS BOOLEAN
FN_CHECK_ROLE_LEVEL(user_id, min_role_code) RETURNS BOOLEAN
```

- 권한 판단 로직이 바뀌면 이 Function들만 수정하면 되고, SP마다 흩어진 동일 로직을 일일이 찾아 고치지 않아도 된다
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
CREATE PROCEDURE USP_COUPON_RESERVE(
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

# 6. 관련 문서

- DB 접근 정책(mysql2, SP 전용): [01_TECH_STACK.md](./01_TECH_STACK.md)
- 테이블별 특징/공통 정책: [04_DATABASE_SCHEMA.md](./04_DATABASE_SCHEMA.md)
- 쿠폰 사용(reserve/confirm) 멱등/동시성 설계 근거: [06_COUPON_USAGE_SCENARIO.md](./06_COUPON_USAGE_SCENARIO.md)
