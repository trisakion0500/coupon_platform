-- ------------------------------------------------------------------------------------------------------------ --
-- 로그 전용 DB(coupon_platform_log) 통합 Procedure 파일. 메인 DB(coupon_platform) 대상 Procedure는
-- database/procedures/all_procedures.sql에 별도로 있다(02_DEV_CONVENTIONS.md 3.1) —
-- LogSpExecutorService(로그 DB 전용 커넥션 풀)만 이 파일의 SP를 호출한다.
-- ------------------------------------------------------------------------------------------------------------ --
DROP PROCEDURE IF EXISTS `SP_LOG_AUDIT_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_AUDIT_CREATE` (
    IN i_action          TINYINT UNSIGNED,  -- 작업유형 (10:CREATE, 20:UPDATE, 30:STATUS_CHANGE)
    IN i_company_id      BIGINT UNSIGNED,   -- 회사 ID (스코핑용, FK 없음)
    IN i_project_id      BIGINT UNSIGNED,   -- 프로젝트 ID (company/user 대상이면 NULL)
    IN i_table_name      VARCHAR(100),      -- 대상 테이블명 (company/project/user/user_role)
    IN i_target_id       VARCHAR(100),      -- 대상 PK 값(단일 PK) 또는 복합 PK JSON 문자열(user_role)
    IN i_target_name     VARCHAR(200),      -- 대상 표시명 스냅샷
    IN i_before_json     LONGTEXT,          -- 변경 전 전체 Row JSON (CREATE는 NULL)
    IN i_after_json      LONGTEXT,          -- 변경 후 전체 Row JSON
    IN i_created_by      BIGINT UNSIGNED,   -- 작업 수행자 user_id
    IN i_created_by_name VARCHAR(50)        -- 작업 수행자명 스냅샷
) COMMENT '감사 로그 적재 (Append-Only, 13_LOG_AUDIT_API.md 2장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_AUDIT_CREATE
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : log_audit 단순 INSERT. 이 SP는 로그 DB(coupon_platform_log)에서만 실행되며,
    --        메인 DB(coupon_platform)와 물리적으로 분리돼 있어 메인 SP가 직접 호출할 수 없다
    --        (02_DEV_CONVENTIONS.md 1장) — 그래서 before_json/after_json/requester_name은
    --        메인 도메인 SP(SP_COMPANY_UPDATE 등)가 이미 계산해 반환한 값을 TS
    --        (LogSpExecutorService.logCall)가 그대로 전달하기만 한다. 권한 검증이 없다 —
    --        외부(HTTP)에 직접 노출되지 않는 백엔드 내부 인프라 호출 전용이고, 호출 시점엔
    --        이미 메인 도메인 SP의 권한 검증(FN_IS_SUPER_ADMIN 등)이 끝난 뒤이기 때문이다.
    --        로그 적재 실패가 메인 트랜잭션에 영향을 주면 안 되므로(LogSpExecutorService.logCall이
    --        예외를 잡아 삼킨다) 이 SP 자체는 RESULT=0/50001만 있으면 충분하고, 데이터 반환용
    --        두 번째 SELECT는 필요 없다(호출부가 반환값을 쓰지 않음).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    INSERT INTO `log_audit` (
        `action`, `company_id`, `project_id`, `table_name`, `target_id`, `target_name`,
        `before_json`, `after_json`, `created_by`, `created_by_name`
    ) VALUES (
        i_action, i_company_id, i_project_id, i_table_name, i_target_id, i_target_name,
        i_before_json, i_after_json, i_created_by, i_created_by_name
    );

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

DROP PROCEDURE IF EXISTS `SP_LOG_AUDIT_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_AUDIT_GET_BY_ID` (
    IN i_idx BIGINT UNSIGNED   -- 조회할 감사 로그 ID
) COMMENT '감사 로그 상세 조회 (13_LOG_AUDIT_API.md 6장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_AUDIT_GET_BY_ID
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : idx 단건 조회, 존재하지 않으면 31008(신규 result 코드, 08_API_COMMON.md 동기화).
    --        SP_LOG_AUDIT_LIST와 동일한 이유로 이 SP 자체는 호출자 권한을 재검증하지 않는다
    --        (로그 DB가 메인 DB의 user/user_role에 물리적으로 접근 불가) - 앱 레이어
    --        (LogAuditService)가 SUPER_ADMIN이 아니면 조회된 행의 company_id가 호출자 소속과
    --        일치하는지 확인해 불일치 시 20001로 거부한다. ProjectService.getById가 SP의
    --        FN_CHECK_COMPANY_ACCESS 재검증에 더해 앱 레이어에서도 같은 판단을 한 번 더 하는
    --        "방어적 이중 체크" 위치와 동일하지만, 여기서는 SP 쪽 재검증이 물리적으로 불가능해
    --        앱 레이어가 유일한 방어선이라는 점이 다르다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `log_audit` WHERE `idx` = i_idx) THEN
            SELECT 31008 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `idx`, `company_id`, `project_id`, `table_name`, `target_id`, `target_name`,
            `action`, `before_json`, `after_json`, `created_by`, `created_by_name`, `created_at`
        FROM `log_audit`
        WHERE `idx` = i_idx;
    END proc_block;
END$$

DELIMITER ;

DROP PROCEDURE IF EXISTS `SP_LOG_AUDIT_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_AUDIT_LIST` (
    IN i_company_id      BIGINT UNSIGNED,   -- 회사 필터(NULL이면 전체) - DEVELOPER 호출 시 앱 레이어가 자기 회사로 강제
    IN i_project_id      BIGINT UNSIGNED,   -- 프로젝트 필터(NULL이면 전체)
    IN i_table_name      VARCHAR(100),      -- 대상 테이블명 필터(NULL이면 전체)
    IN i_target_id       VARCHAR(100),      -- 대상 식별자 필터(NULL이면 전체)
    IN i_action          TINYINT UNSIGNED,  -- 작업유형 필터(NULL이면 전체)
    IN i_from_created_at DATETIME,          -- 조회 시작일시(NULL이면 하한 없음)
    IN i_to_created_at   DATETIME,          -- 조회 종료일시(NULL이면 상한 없음)
    IN i_page_size       INT,               -- 페이지당 행 수
    IN i_offset          INT                -- 시작 오프셋
) COMMENT '감사 로그 목록 조회 - 페이지네이션 (13_LOG_AUDIT_API.md 5장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_AUDIT_LIST
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : log_audit를 created_at DESC로 정렬해 페이지 단위로 반환한다(13_LOG_AUDIT_API.md 5장
    --        Sorting). 이 SP는 로그 DB(coupon_platform_log)에서 실행되며 메인 DB의 user/user_role
    --        테이블에 접근할 수 없다(02_DEV_CONVENTIONS.md 1장, 물리 분리) - 그래서 이 프로젝트의
    --        일반 원칙("SP가 FN_IS_SUPER_ADMIN 등으로 호출자 권한을 스스로 재검증")을 여기서는
    --        적용할 수 없다. 권한 판단(SUPER_ADMIN 전체조회/DEVELOPER는 본인 소속 company_id로
    --        고정 스코핑, 13_LOG_AUDIT_API.md 3장)은 전부 앱 레이어(LogAuditService)가 담당하고,
    --        i_company_id는 이미 스코핑이 끝난 값을 그대로 받는다 - SP_LOG_AUDIT_CREATE가 같은
    --        이유(로그 DB는 인프라 호출 전용, 메인 SP가 권한 검증을 이미 끝낸 뒤 호출)로 권한
    --        검증 자체를 아예 두지 않는 것과 같은 물리적 제약이다.
    --        total_count는 다른 목록 SP(SP_PROJECT_LIST 등)와 동일하게 COUNT(*) OVER()가 아니라
    --        별도 서브쿼리 + LEFT JOIN ... ON TRUE 패턴으로 반환한다(offset이 범위를 벗어나 0행이
    --        반환돼도 total_count가 0으로 사라지지 않도록).
    --        정렬은 `created_at DESC, idx DESC` 2단 키다 - `created_at`이 초 단위 정밀도(DATETIME,
    --        마이크로초 없음)라 같은 초 안에 두 로그가 생성되면(예: CREATE 직후 곧바로 UPDATE)
    --        `created_at`만으로는 동순위가 되어 MySQL이 삽입 순서를 보장해주지 않는다 - 실제로
    --        스모크 테스트에서 CREATE가 UPDATE보다 나중에 나오는(최신순이 아닌) 경우가 재현됨
    --        (2026-07-22). `idx`는 AUTO_INCREMENT라 생성 순서와 완전히 동일하므로 2차 키로 쓰면
    --        타이밍에 의존하지 않고 항상 정확한 최신순이 보장된다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    SELECT 0 AS RESULT;
    SELECT
        lg.`idx`, lg.`company_id`, lg.`project_id`, lg.`table_name`, lg.`target_id`,
        lg.`target_name`, lg.`action`, lg.`created_by`, lg.`created_by_name`, lg.`created_at`,
        cnt.`total_count`
    FROM (
        SELECT COUNT(*) AS total_count
        FROM `log_audit`
        WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
          AND (i_project_id IS NULL OR `project_id` = i_project_id)
          AND (i_table_name IS NULL OR `table_name` = i_table_name)
          AND (i_target_id IS NULL OR `target_id` = i_target_id)
          AND (i_action IS NULL OR `action` = i_action)
          AND (i_from_created_at IS NULL OR `created_at` >= i_from_created_at)
          AND (i_to_created_at IS NULL OR `created_at` <= i_to_created_at)
    ) cnt
    LEFT JOIN (
        SELECT `idx`, `company_id`, `project_id`, `table_name`, `target_id`,
               `target_name`, `action`, `created_by`, `created_by_name`, `created_at`
        FROM `log_audit`
        WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
          AND (i_project_id IS NULL OR `project_id` = i_project_id)
          AND (i_table_name IS NULL OR `table_name` = i_table_name)
          AND (i_target_id IS NULL OR `target_id` = i_target_id)
          AND (i_action IS NULL OR `action` = i_action)
          AND (i_from_created_at IS NULL OR `created_at` >= i_from_created_at)
          AND (i_to_created_at IS NULL OR `created_at` <= i_to_created_at)
        ORDER BY `created_at` DESC, `idx` DESC
        LIMIT i_page_size OFFSET i_offset
    ) lg ON TRUE;
END$$

DELIMITER ;

DROP PROCEDURE IF EXISTS `SP_LOG_COUPON_CAMPAIGN_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_COUPON_CAMPAIGN_CREATE` (
    IN i_action              TINYINT UNSIGNED, -- 작업유형 (10:CREATE,20:UPDATE,30:STATUS_CHANGE,40:APPROVE,50:REJECT)
    IN i_coupon_campaign_id  BIGINT UNSIGNED,  -- 원본 캠페인 ID
    IN i_project_id          BIGINT UNSIGNED,  -- 프로젝트 ID (스냅샷)
    IN i_name                VARCHAR(100),     -- 캠페인명 (스냅샷)
    IN i_campaign_start      DATETIME,         -- 시작일시 (스냅샷)
    IN i_campaign_end        DATETIME,         -- 종료일시 (스냅샷)
    IN i_code_type           TINYINT UNSIGNED, -- 코드 발급 방식 (스냅샷)
    IN i_use_hyphen          TINYINT UNSIGNED, -- 하이픈 포함 여부 (스냅샷)
    IN i_requested_qty       INT UNSIGNED,     -- 목표 발급 수량 (스냅샷)
    IN i_generated_qty       INT UNSIGNED,     -- 실제 발급 수량 (스냅샷)
    IN i_usable_qty          INT UNSIGNED,     -- 실제 사용가능 수량 (스냅샷)
    IN i_used_qty            INT UNSIGNED,     -- 실제 사용 수량 (스냅샷)
    IN i_use_limit_per_user  INT UNSIGNED,     -- 재사용 허용 횟수 (스냅샷)
    IN i_status              TINYINT UNSIGNED, -- 상태 (스냅샷)
    IN i_approval_status     TINYINT UNSIGNED, -- 승인상태 (스냅샷)
    IN i_approved_by         BIGINT UNSIGNED,  -- 승인/반려 처리자 ID (스냅샷, NULL 가능)
    IN i_approved_at         DATETIME,         -- 승인/반려 처리일시 (스냅샷, NULL 가능)
    IN i_reject_reason       VARCHAR(500),     -- 반려 사유 (스냅샷, NULL 가능)
    IN i_reward_data         JSON,             -- 보상 내용 (스냅샷)
    IN i_created_by          BIGINT UNSIGNED,  -- 이 로그 행(액션)을 수행한 사용자 ID
    IN i_created_by_name     VARCHAR(50)       -- 이 로그 행(액션)을 수행한 사용자명 스냅샷
) COMMENT '쿠폰 캠페인 변경 이력 적재 (Append-Only, 04_DATABASE_SCHEMA.md 10장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_COUPON_CAMPAIGN_CREATE
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : log_coupon_campaign 단순 INSERT. 이 SP는 로그 DB(coupon_platform_log)에서만
    --        실행되며, 메인 DB(coupon_platform)와 물리적으로 분리돼 있어 메인 도메인 SP
    --        (SP_CAMPAIGN_CREATE 등)가 직접 호출할 수 없다(02_DEV_CONVENTIONS.md 1장) - 그래서
    --        메인 도메인 SP가 반환한 캠페인 행 전체를 TS(LogSpExecutorService.logCall)가 그대로
    --        전달하기만 한다. log_audit(SP_LOG_AUDIT_CREATE)와 달리 before_json/after_json
    --        JSON 스냅샷 방식이 아니라 coupon_campaign 컬럼을 그대로 복제하는 구조라
    --        (04_DATABASE_SCHEMA.md 10장 - 타입 보존, JSON 파싱 없이 특정 시점 특정 컬럼 값을
    --        바로 조회 가능) before 상태 캡처 자체가 필요 없다 - 매 액션마다 "그 시점의 최종
    --        상태" 한 장만 남기면 된다.
    -- 수정1: 2026.07.22 trisakion — created_by_name 파라미터/컬럼 추가(17_CAMPAIGN_API.md 4.2
    --        GET /campaigns/{id}/logs 조회 API 설계 중 소급 반영). 최초 설계 시엔 "필요 시
    --        created_by(user_id)로 조회 시점에 조인하면 된다"고 이 스냅샷 없이 시작했으나, 이
    --        로그는 메인 DB와 물리 분리된 로그 DB에 있어 애초에 조인이 불가능하다(02_DEV_CONVENTIONS.md
    --        1장, log_audit이 처음부터 created_by_name을 둔 것과 동일 제약 — 잘못된 전제였음).
    --        메인 도메인 SP(SP_CAMPAIGN_CREATE 등, 수정1)가 user 테이블에서 직접 조회해 반환하는
    --        requester_name을 TS가 그대로 이 파라미터로 전달한다.
    --        권한 검증이 없다 - 외부(HTTP)에 직접 노출되지 않는 백엔드 내부 인프라 호출 전용이고,
    --        호출 시점엔 이미 메인 도메인 SP의 권한 검증이 끝난 뒤이기 때문이다. 로그 적재 실패가
    --        메인 트랜잭션에 영향을 주면 안 되므로(LogSpExecutorService.logCall이 예외를 잡아
    --        삼킨다) 이 SP 자체는 RESULT=0/50001만 있으면 충분하고, 데이터 반환용 두 번째
    --        SELECT는 필요 없다(02_DEV_CONVENTIONS.md 3.4 예외 - SP_LOG_AUDIT_CREATE와 동일).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    INSERT INTO `log_coupon_campaign` (
        `action`, `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
        `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `usable_qty`, `used_qty`,
        `use_limit_per_user`, `status`, `approval_status`, `approved_by`, `approved_at`,
        `reject_reason`, `reward_data`, `created_by`, `created_by_name`
    ) VALUES (
        i_action, i_coupon_campaign_id, i_project_id, i_name, i_campaign_start, i_campaign_end,
        i_code_type, i_use_hyphen, i_requested_qty, i_generated_qty, i_usable_qty, i_used_qty,
        i_use_limit_per_user, i_status, i_approval_status, i_approved_by, i_approved_at,
        i_reject_reason, i_reward_data, i_created_by, i_created_by_name
    );

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

DROP PROCEDURE IF EXISTS `SP_LOG_COUPON_CAMPAIGN_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_COUPON_CAMPAIGN_LIST` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID (필수 - 이 API는 항상 특정 캠페인에 종속)
    IN i_action             TINYINT UNSIGNED, -- 작업유형 필터(NULL이면 전체, 10:CREATE/20:UPDATE/30:STATUS_CHANGE/40:APPROVE/50:REJECT)
    IN i_page_size          INT,              -- 페이지당 행 수
    IN i_offset             INT               -- 시작 오프셋
) COMMENT '캠페인 변경 이력 목록 조회 - coupon_campaign_id 필수, 페이지네이션 (17_CAMPAIGN_API.md 4.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_COUPON_CAMPAIGN_LIST
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : log_coupon_campaign을 coupon_campaign_id로 필터링해 created_at DESC로 정렬 후 페이지
    --        단위로 반환한다. 이 SP는 로그 DB(coupon_platform_log)에서 실행되며 메인 DB의
    --        coupon_campaign/user/user_role 테이블에 접근할 수 없다(02_DEV_CONVENTIONS.md 1장,
    --        물리 분리) - 그래서 이 프로젝트의 일반 원칙("SP가 FN_CHECK_PROJECT_ACCESS 등으로
    --        호출자 권한을 스스로 재검증")을 여기서는 적용할 수 없다(SP_LOG_AUDIT_LIST와 동일한
    --        구조적 제약, 02_DEV_CONVENTIONS.md 3.2 예외 참고). 캠페인 존재확인(31004)+프로젝트
    --        스코핑(20001) 재검증은 앱(TS) 레이어가 이 SP 호출 전에 메인 DB에서 먼저 수행한다
    --        (CampaignService가 이미 갖고 있는 존재확인+스코핑 체크 재사용, SP_CAMPAIGN_GET_BY_ID와
    --        동일 로직) - "메인 DB 접근권한 확인 → 로그 DB 목록 조회" 2단계 패턴
    --        (02_DEV_CONVENTIONS.md 3.2 신규 예외 항목 참고).
    --        total_count는 다른 목록 SP와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 +
    --        LEFT JOIN ... ON TRUE 패턴으로 반환한다(offset이 범위를 벗어나 0행이 반환돼도
    --        total_count가 0으로 사라지지 않도록).
    --        정렬은 SP_LOG_AUDIT_LIST와 동일하게 `created_at DESC, idx DESC` 2단 키다 - created_at
    --        (DATETIME, 마이크로초 없음)만으로는 같은 초 안에 여러 액션이 겹칠 때 순서가 보장되지
    --        않는다(2026-07-22 SP_LOG_AUDIT_LIST에서 실제 재현된 문제, 동일 원인이라 처음부터
    --        2단 키로 작성).
    --        응답 컬럼은 log_coupon_campaign 전체(coupon_campaign 컬럼 스냅샷 + action +
    --        created_by/created_by_name/created_at) 그대로다 - before/after 비교(diff)는 이 SP가
    --        하지 않고 프론트엔드가 인접한 두 행을 비교해 표시한다(17_CAMPAIGN_API.md 4.2).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    SELECT 0 AS RESULT;
    SELECT
        lc.`idx`, lc.`action`, lc.`coupon_campaign_id`, lc.`project_id`, lc.`name`,
        lc.`campaign_start`, lc.`campaign_end`, lc.`code_type`, lc.`use_hyphen`,
        lc.`requested_qty`, lc.`generated_qty`, lc.`usable_qty`, lc.`used_qty`,
        lc.`use_limit_per_user`, lc.`status`, lc.`approval_status`, lc.`approved_by`,
        lc.`approved_at`, lc.`reject_reason`, lc.`reward_data`, lc.`created_by`,
        lc.`created_by_name`, lc.`created_at`,
        cnt.`total_count`
    FROM (
        SELECT COUNT(*) AS total_count
        FROM `log_coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND (i_action IS NULL OR `action` = i_action)
    ) cnt
    LEFT JOIN (
        SELECT
            `idx`, `action`, `coupon_campaign_id`, `project_id`, `name`, `campaign_start`,
            `campaign_end`, `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`,
            `usable_qty`, `used_qty`, `use_limit_per_user`, `status`, `approval_status`,
            `approved_by`, `approved_at`, `reject_reason`, `reward_data`, `created_by`,
            `created_by_name`, `created_at`
        FROM `log_coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND (i_action IS NULL OR `action` = i_action)
        ORDER BY `created_at` DESC, `idx` DESC
        LIMIT i_page_size OFFSET i_offset
    ) lc ON TRUE;
END$$

DELIMITER ;

DROP PROCEDURE IF EXISTS `SP_LOG_COUPON_USE_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_COUPON_USE_CREATE` (
    IN i_action              TINYINT UNSIGNED, -- 요청 유형 (10:RESERVE, 20:CONFIRM)
    IN i_project_id          BIGINT UNSIGNED,  -- 프로젝트 ID (S2S 인증으로 스코핑된 값)
    IN i_coupon_campaign_id  BIGINT UNSIGNED,  -- 캠페인 ID (코드 자체가 없는 시도는 NULL)
    IN i_code_value          VARCHAR(50),      -- 시도한 쿠폰 코드 문자열 원문
    IN i_game_user_id        VARCHAR(100),     -- 게임서버 유저 식별자
    IN i_result_type         TINYINT UNSIGNED, -- 처리 결과 (0:성공,10:코드없음,20:이미소모/중지,30:캠페인사용불가,40:사용자한도초과,50:소모기록없음)
    IN i_caller_ip           VARCHAR(45)       -- 호출한 게임서버의 IP(IPv6 포함, NULL 가능) — 인증 목적 아님, 이상징후 탐지/장애조사 보조용
) COMMENT '쿠폰 사용(reserve/confirm) 시도 이력 적재 (Append-Only, 18_COUPON_USAGE_API.md 1.5/4장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_COUPON_USE_CREATE
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : log_coupon_use 단순 INSERT. SP_LOG_COUPON_CAMPAIGN_CREATE와 동일하게 로그 DB
    --        (coupon_platform_log)에서만 실행되며, 메인 도메인 SP(SP_COUPON_RESERVE/CONFIRM)가
    --        직접 호출할 수 없어(02_DEV_CONVENTIONS.md 1장 - 물리적으로 분리된 별도 DB) TS
    --        서비스(CouponUsageService)가 메인 SP 호출 결과를 보고 성공/실패 여부와 무관하게
    --        매 호출마다 이 SP를 fire-and-forget으로 호출한다(18_COUPON_USAGE_API.md 1.5).
    --        log_coupon_campaign과 달리 성공한 소모 건의 스냅샷이 아니라 "시도 자체"의 기록이라
    --        RESERVE/CONFIRM 요청 바디 값(project_id/code_value/game_user_id)과 결과
    --        (result_type)만 담는다 - 실패 시엔 관련 도메인 행 자체가 없거나(코드없음) 바뀌지
    --        않으므로(다른 실패) 스냅샷 개념이 성립하지 않는다. 권한 검증 없음 - 외부(HTTP)에
    --        직접 노출되지 않는 백엔드 내부 인프라 호출 전용(SP_LOG_COUPON_CAMPAIGN_CREATE와
    --        동일한 이유). 데이터 반환용 두 번째 SELECT는 필요 없다(02_DEV_CONVENTIONS.md 3.4
    --        예외 - SP_LOG_AUDIT_CREATE와 동일).
    -- 수정1: 2026.07.23 trisakion — caller_ip 컬럼 추가에 맞춰 i_caller_ip 파라미터를 받아 그대로
    --        INSERT한다. TS(CouponUsageController)가 Express req.ip(main.ts trust proxy=1
    --        설정으로 로드밸런서 뒤에서도 실제 호출자 IP)를 캡처해 넘긴다 - 이 SP는 값을 그대로
    --        저장만 할 뿐 검증/가공하지 않는다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    INSERT INTO `log_coupon_use` (
        `action`, `project_id`, `coupon_campaign_id`, `code_value`, `game_user_id`, `result_type`,
        `caller_ip`
    ) VALUES (
        i_action, i_project_id, i_coupon_campaign_id, i_code_value, i_game_user_id, i_result_type,
        i_caller_ip
    );

    SELECT 0 AS RESULT;
END$$

DELIMITER ;


DROP PROCEDURE IF EXISTS `SP_LOG_COUPON_USE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_COUPON_USE_LIST` (
    IN i_project_id         BIGINT UNSIGNED,   -- 필수 - 스코핑 기준(17_CAMPAIGN_API.md 4.3, 회사 단위 조회 예외 없음)
    IN i_coupon_campaign_id BIGINT UNSIGNED,   -- 선택 - 특정 캠페인으로 좁힘(NULL이면 프로젝트 전체, 코드 자체가 없는 시도(campaign_id NULL 행) 포함)
    IN i_game_user_id       VARCHAR(100),      -- 선택 필터
    IN i_code_value         VARCHAR(50),       -- 선택 필터
    IN i_action             TINYINT UNSIGNED,  -- 선택 필터 (10:RESERVE, 20:CONFIRM)
    IN i_result_type        TINYINT UNSIGNED,  -- 선택 필터 (04_DATABASE_SCHEMA.md 11장)
    IN i_from_created_at    DATETIME,          -- 조회 시작일시(NULL이면 하한 없음)
    IN i_to_created_at      DATETIME,          -- 조회 종료일시(NULL이면 상한 없음)
    IN i_page_size          INT,               -- 페이지당 행 수
    IN i_offset             INT                -- 시작 오프셋
) COMMENT '쿠폰 사용 시도 로그 목록 조회 - project_id 필수, 페이지네이션 (17_CAMPAIGN_API.md 4.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_COUPON_USE_LIST
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : log_coupon_use를 project_id로 필터링해 created_at DESC로 정렬 후 페이지 단위로
    --        반환한다. 이 SP는 로그 DB(coupon_platform_log)에서 실행되며 메인 DB의
    --        coupon_campaign/user/user_role 테이블에 접근할 수 없다(02_DEV_CONVENTIONS.md 1장,
    --        물리 분리) - SP_LOG_AUDIT_LIST/SP_LOG_COUPON_CAMPAIGN_LIST와 동일한 구조적 제약으로
    --        이 SP는 권한 재검증을 하지 않는다(02_DEV_CONVENTIONS.md 3.2 예외). project_id
    --        접근권한 확인은 앱(TS) 레이어가 이 SP 호출 전에 신규 SP_PROJECT_CHECK_ACCESS(메인 DB)
    --        로 먼저 수행한다 - "메인 DB 접근권한 확인 → 로그 DB 목록 조회" 2단계 패턴
    --        (02_DEV_CONVENTIONS.md 3.2). log_coupon_campaign(4.2)과 달리 이 로그는 project_id에
    --        종속되고 coupon_campaign_id에는 종속되지 않는다(NULL 허용 - 코드 자체가 존재하지
    --        않는 시도는 캠페인을 특정할 수 없음, 04_DATABASE_SCHEMA.md 11장) - 그래서 접근권한
    --        확인 대상이 "특정 캠페인"이 아니라 "프로젝트"이고, 전용 체크 SP가 별도로 필요했다
    --        (SP_CAMPAIGN_LIST처럼 FN_CHECK_PROJECT_ACCESS를 SP 안에서 바로 쓸 수 있는 건
    --        coupon_campaign이 메인 DB에 있어서 가능한 것 - 이 SP는 그 전제가 성립하지 않는다).
    --        total_count는 다른 목록 SP와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 +
    --        LEFT JOIN ... ON TRUE 패턴으로 반환한다.
    --        정렬은 SP_LOG_AUDIT_LIST/SP_LOG_COUPON_CAMPAIGN_LIST와 동일하게 `created_at DESC,
    --        idx DESC` 2단 키다(같은 초 안에 여러 시도가 겹치는 경우 순서 보장 목적).
    --        campaign_name(응답에 필요, 17_CAMPAIGN_API.md 4.3)은 이 SP가 채우지 않는다 - 메인
    --        DB(coupon_campaign)와 물리 분리라 조인이 불가능해, coupon_campaign_id가 있는 행만
    --        앱(TS) 레이어가 메인 DB에서 배치 조회해 응답 조립 시 붙인다.
    -- 수정1: 2026.07.23 trisakion — log_coupon_use.caller_ip 추가에 맞춰 응답에 caller_ip를
    --        포함한다. 이 로그를 사람이 들여다보는 유일한 창구가 4.3이라, 저장만 하고 조회
    --        API에서 빠뜨리면 사실상 못 쓰는 컬럼이 되므로 함께 반영.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    SELECT 0 AS RESULT;
    SELECT
        lu.`idx`, lu.`action`, lu.`project_id`, lu.`coupon_campaign_id`, lu.`code_value`,
        lu.`game_user_id`, lu.`result_type`, lu.`caller_ip`, lu.`created_at`,
        cnt.`total_count`
    FROM (
        SELECT COUNT(*) AS total_count
        FROM `log_coupon_use`
        WHERE `project_id` = i_project_id
          AND (i_coupon_campaign_id IS NULL OR `coupon_campaign_id` = i_coupon_campaign_id)
          AND (i_game_user_id IS NULL OR `game_user_id` = i_game_user_id)
          AND (i_code_value IS NULL OR `code_value` = i_code_value)
          AND (i_action IS NULL OR `action` = i_action)
          AND (i_result_type IS NULL OR `result_type` = i_result_type)
          AND (i_from_created_at IS NULL OR `created_at` >= i_from_created_at)
          AND (i_to_created_at IS NULL OR `created_at` <= i_to_created_at)
    ) cnt
    LEFT JOIN (
        SELECT `idx`, `action`, `project_id`, `coupon_campaign_id`, `code_value`,
               `game_user_id`, `result_type`, `caller_ip`, `created_at`
        FROM `log_coupon_use`
        WHERE `project_id` = i_project_id
          AND (i_coupon_campaign_id IS NULL OR `coupon_campaign_id` = i_coupon_campaign_id)
          AND (i_game_user_id IS NULL OR `game_user_id` = i_game_user_id)
          AND (i_code_value IS NULL OR `code_value` = i_code_value)
          AND (i_action IS NULL OR `action` = i_action)
          AND (i_result_type IS NULL OR `result_type` = i_result_type)
          AND (i_from_created_at IS NULL OR `created_at` >= i_from_created_at)
          AND (i_to_created_at IS NULL OR `created_at` <= i_to_created_at)
        ORDER BY `created_at` DESC, `idx` DESC
        LIMIT i_page_size OFFSET i_offset
    ) lu ON TRUE;
END$$

DELIMITER ;
