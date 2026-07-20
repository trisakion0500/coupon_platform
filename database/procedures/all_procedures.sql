-- ------------------------------------------------------------------------------------------------------------ --
-- 통합 SP/Function 파일 — database/tables/all_tables.sql과 동일한 목적(로컬 개발 편의용 한 번에 적용).
-- 테이블과 달리 SP 사이에는 FK 의존성이 없어 순서 제약이 없다 — 알파벳순으로 나열한다.
-- 개별 파일을 수정하면 이 파일도 반드시 함께 갱신할 것(all_tables.sql과 동일한 동기화 원칙).
-- ------------------------------------------------------------------------------------------------------------ --

-- ============================================================================================================ --
-- SP_CAMPAIGN_APPROVE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_APPROVE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_APPROVE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 승인할 캠페인 ID
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 승인 - OPERATOR 승인불가(20001), approval_status 2->3 조건부 UPDATE (17_CAMPAIGN_API.md 2.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_APPROVE
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 + 승인권한 재검증 -> 조건부 UPDATE 순으로
    --        처리한다. 승인은 SUPER_ADMIN/DEVELOPER/MANAGER만 가능하고 OPERATOR는 불가하다
    --        (17_CAMPAIGN_API.md 2.6 Permission) - FN_GET_PROJECT_ROLE_CODE로 얻은 role_code가
    --        40(OPERATOR)이면 "배정은 있으나 승인 권한이 없는" 경우이므로 이것도 20001로 응답한다
    --        (배정 자체가 없는 경우와 동일한 코드를 쓴다 - 이 도메인은 "권한 부족"과 "배정 없음"을
    --        세분화하지 않는다, 02_DEV_CONVENTIONS.md 3.2 원칙과 동일하게 SP가 최종 방어선).
    --        approval_status=2(승인대기)가 아니거나 status=4(종료)면 조건부 UPDATE가 0건이 되어
    --        30004로 응답한다(17_CAMPAIGN_API.md 2.6 State Transition, 1.3 종료 잠금).
    --        log_coupon_campaign(action=40 APPROVE) 기록은 SP_CAMPAIGN_CREATE와 동일한 이유로
    --        이 SP가 직접 하지 않는다 - 반환 행 전체를 TS 서비스가
    --        SP_LOG_COUPON_CAMPAIGN_CREATE(로그 DB)에 그대로 전달한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_role        TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_project_id  BIGINT UNSIGNED  DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id
        ) THEN
            SELECT 31004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `project_id` INTO v_project_id
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

        IF FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SET v_role = 10;
        ELSE
            SET v_role = FN_GET_PROJECT_ROLE_CODE(i_requester_user_id, v_project_id);
        END IF;

        IF v_role IS NULL OR v_role > 30 THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `coupon_campaign`
        SET
            `approval_status` = 3,
            `approved_by`      = i_requester_user_id,
            `approved_at`      = NOW(),
            `updated_by`       = i_requester_user_id
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `approval_status` = 2
          AND `status` <> 4;

        IF ROW_COUNT() = 0 THEN
            SELECT 30004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_CAMPAIGN_CHANGE_STATUS
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CHANGE_STATUS`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CHANGE_STATUS` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_status             TINYINT UNSIGNED, -- 전환할 목표 상태
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 상태변경 - 전이표 전체를 하나의 조건부 UPDATE로 원자 처리 (17_CAMPAIGN_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CHANGE_STATUS
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001, role_code
    --        값 자체는 필요 없어 FN_GET_PROJECT_ROLE_CODE 대신 boolean 버전을 쓴다) -> 허용된
    --        전이표(17_CAMPAIGN_API.md 2.5) 전체를 WHERE절 하나에 담아 조건부 UPDATE로 원자
    --        처리한다(02_DEV_CONVENTIONS.md 4장 "동시성이 필요한 UPDATE는 조건부 갱신 우선").
    --        조건부 UPDATE 하나로 "현재 status가 무엇이든, 그 status에서 목표 status로의 전이가
    --        허용되는지 + (활성화 전이면) 승인 여부"까지 동시에 검증하므로, 상태를 먼저 읽어와
    --        다시 비교하는 check-then-act 없이 동시 요청에도 안전하다. ROW_COUNT()=0이면(존재/
    --        권한은 이미 통과했으므로) 남은 원인은 오직 "허용되지 않는 전이"뿐이라 30004로 확정
    --        할 수 있다. i_status가 전이표에 아예 없는 값이어도 WHERE절의 어떤 OR 분기와도
    --        매칭되지 않아 자연스럽게 0건으로 걸러진다.
    --        log_coupon_campaign(action=30 STATUS_CHANGE) 기록은 SP_CAMPAIGN_CREATE와 동일한
    --        이유로 이 SP가 직접 하지 않는다 - 반환 행 전체를 TS 서비스가
    --        SP_LOG_COUPON_CAMPAIGN_CREATE(로그 DB)에 그대로 전달한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id
        ) THEN
            SELECT 31004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `project_id` INTO v_project_id
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_PROJECT_ACCESS(i_requester_user_id, v_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `coupon_campaign`
        SET `status` = i_status, `updated_by` = i_requester_user_id
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND (
              (`status` = 1 AND i_status = 2 AND `approval_status` IN (1, 3)) OR
              (`status` = 1 AND i_status = 4) OR
              (`status` = 2 AND i_status = 3) OR
              (`status` = 2 AND i_status = 4) OR
              (`status` = 3 AND i_status = 2 AND `approval_status` IN (1, 3)) OR
              (`status` = 3 AND i_status = 4)
          );

        IF ROW_COUNT() = 0 THEN
            SELECT 30004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_CAMPAIGN_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CREATE` (
    IN i_project_id        BIGINT UNSIGNED,  -- 소속 프로젝트 ID
    IN i_name               VARCHAR(100),     -- 캠페인명
    IN i_campaign_start     DATETIME,         -- 사용 가능 시작일시
    IN i_campaign_end       DATETIME,         -- 사용 가능 종료일시
    IN i_code_type          TINYINT UNSIGNED, -- 코드 발급 방식 (1:RANDOM, 2:FIXED)
    IN i_use_hyphen         TINYINT UNSIGNED, -- 하이픈 포함 여부 (RANDOM에만 적용)
    IN i_requested_qty      INT UNSIGNED,     -- 목표 발급 수량 (FIXED면 서버가 1로 강제)
    IN i_use_limit_per_user INT UNSIGNED,     -- 동일 유저 재사용 허용 횟수
    IN i_reward_data        JSON,             -- 보상 내용(자유 스키마, pass-through)
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 생성 - 프로젝트 스코핑 재검증, role_code 기반 approval_status 자동결정 (17_CAMPAIGN_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CREATE
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 쿠폰 도메인 최초 SP. 캠페인/코드 컨트롤은 회사 단위가 아니라 항상 **프로젝트 단위**로
    --        스코핑한다(17_CAMPAIGN_API.md 1.2) — company/project/user 도메인의 "DEVELOPER는
    --        회사 전체 조회" 예외가 이 도메인에는 적용되지 않는다. SUPER_ADMIN은 FN_IS_SUPER_ADMIN
    --        으로 우회하고, 그 외 role은 FN_GET_PROJECT_ROLE_CODE(i_requester_user_id,
    --        i_project_id)로 해당 프로젝트에 실제 활성 배정된 role_code를 얻는다(NULL이면 배정
    --        자체가 없다는 뜻 -> 20001). 이렇게 얻은 role_code로 approval_status를 자동 결정한다
    --        (role_code<=30 즉 SUPER_ADMIN/DEVELOPER/MANAGER면 1:승인불요, OPERATOR(40)면
    --        2:승인대기 — 17_CAMPAIGN_API.md 2.1 Business Rules). project_id 자체의 존재 확인은
    --        FN_GET_PROJECT_ROLE_CODE가 이미 project FK를 통해 암묵적으로 검증하지만(존재하지
    --        않는 project_id는 배정도 있을 수 없음), SUPER_ADMIN 우회 경로는 이 검증을 건너뛰므로
    --        별도로 존재 확인(31002)을 먼저 한다.
    --        code_type=2(FIXED)면 요청값과 무관하게 requested_qty를 항상 1로 고정한다
    --        (05_COUPON_ISSUANCE_SCENARIO.md 2장 — FIXED는 캠페인당 코드 1건뿐이며, "generated_qty
    --        == requested_qty -> 완료" 판정 로직을 RANDOM과 동일하게 재사용하기 위함).
    --        usable_qty/generated_qty/used_qty/generation_status/generation_error는 테이블
    --        DEFAULT(0/0/0/1/NULL)를 그대로 따르므로 이 SP는 건드리지 않는다 — 코드는 아직 하나도
    --        발급되지 않았으므로 usable_qty를 0보다 크게 열어둘 이유가 없다.
    --        log_coupon_campaign(action=10 CREATE) 기록은 이 SP가 직접 하지 않는다 — 로그 DB가
    --        물리적으로 분리돼 있어(02_DEV_CONVENTIONS.md 1장) 메인 SP가 호출할 수 없으므로, 이
    --        SP가 반환하는 생성된 행 전체를 TS 서비스가 그대로 SP_LOG_COUPON_CAMPAIGN_CREATE(로그
    --        DB)에 전달한다. log_audit(before/after JSON)와 달리 log_coupon_campaign은 컬럼을
    --        그대로 복제하는 구조라(04_DATABASE_SCHEMA.md 10장) 이 SP가 별도 JSON 캡처를 할 필요가
    --        없다 — 반환 행 자체가 곧 로그에 필요한 전부다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_role            TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_approval_status TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_requested_qty   INT UNSIGNED     DEFAULT NULL;
    DECLARE v_campaign_id     BIGINT UNSIGNED  DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SET v_role = 10;
        ELSE
            SET v_role = FN_GET_PROJECT_ROLE_CODE(i_requester_user_id, i_project_id);
            IF v_role IS NULL THEN
                SELECT 20001 AS RESULT;
                LEAVE proc_block;
            END IF;
        END IF;

        SET v_approval_status = IF(v_role <= 30, 1, 2);
        SET v_requested_qty = IF(i_code_type = 2, 1, i_requested_qty);

        INSERT INTO `coupon_campaign` (
            `project_id`, `name`, `campaign_start`, `campaign_end`, `code_type`, `use_hyphen`,
            `requested_qty`, `use_limit_per_user`, `approval_status`, `reward_data`,
            `created_by`, `updated_by`
        ) VALUES (
            i_project_id, i_name, i_campaign_start, i_campaign_end, i_code_type, i_use_hyphen,
            v_requested_qty, i_use_limit_per_user, v_approval_status, i_reward_data,
            i_requester_user_id, i_requester_user_id
        );

        SET v_campaign_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = v_campaign_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_CAMPAIGN_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_GET_BY_ID` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 조회할 캠페인 ID
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 단건 조회 - 미존재 31004, 스코핑 범위 밖 20001 (17_CAMPAIGN_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_GET_BY_ID
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 존재 확인(31004) -> project_id 조회 -> 프로젝트 스코핑 재검증(20001) 순으로 처리한다.
    --        17_CAMPAIGN_API.md 1.2/2.3 — "존재하지 않음"과 "스코핑 범위 밖"을 분리해서 각각
    --        31004/20001로 응답한다(2026-07-20 문서 정정 — 이전에 2.3/4.1에 남아있던 "둘 다
    --        31004" 서술은 1.2 일반 원칙과 어긋난 오기였고, 사용자 확인 후 20001로 통일함 —
    --        company/project/user 도메인의 "스코핑 밖=20001" 선례와도 일치).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id
        ) THEN
            SELECT 31004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `project_id` INTO v_project_id
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_PROJECT_ACCESS(i_requester_user_id, v_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_CAMPAIGN_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_LIST` (
    IN i_project_id        BIGINT UNSIGNED,   -- 필수 - 스코핑 기준(17_CAMPAIGN_API.md 2.2, 회사 단위 아님)
    IN i_status            TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_approval_status   TINYINT UNSIGNED,  -- 승인상태 필터 (NULL이면 전체)
    IN i_generation_status TINYINT UNSIGNED,  -- 코드 생성 진행상태 필터 (NULL이면 전체)
    IN i_code_type         TINYINT UNSIGNED,  -- 코드 발급 방식 필터 (NULL이면 전체)
    IN i_page_size         INT,               -- 페이지당 행 수
    IN i_offset            INT,               -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED    -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 목록 조회 - project_id 필수 스코핑, 페이지네이션 (17_CAMPAIGN_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_LIST
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : company/project 도메인의 목록 조회와 달리, 이 도메인은 "회사 전체 조회" 예외가 없고
    --        DEVELOPER/MANAGER/OPERATOR 전부 project_id 단위로만 스코핑한다(17_CAMPAIGN_API.md
    --        1.2). 그래서 i_project_id는 필수이며(company_id처럼 NULL 허용 아님), SUPER_ADMIN
    --        우회 후에는 FN_CHECK_PROJECT_ACCESS로 호출자가 그 프로젝트에 실제 활성 배정이
    --        있는지만 확인하면 된다(role_code 값 자체는 이 SP의 분기에 필요 없음 —
    --        FN_GET_PROJECT_ROLE_CODE가 아니라 FN_CHECK_PROJECT_ACCESS를 쓰는 이유).
    --        total_count는 SP_PROJECT_LIST와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 +
    --        LEFT JOIN ... ON TRUE 패턴으로 반환한다(02_DEV_CONVENTIONS.md 3.6).
    --        정렬은 status DESC, created_at DESC(17_CAMPAIGN_API.md 2.2 Sorting).
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
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_PROJECT_ACCESS(i_requester_user_id, i_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            pg.`coupon_campaign_id`, pg.`project_id`, pg.`name`, pg.`code_type`,
            pg.`requested_qty`, pg.`generated_qty`, pg.`generation_status`,
            pg.`usable_qty`, pg.`used_qty`, pg.`status`, pg.`approval_status`,
            pg.`campaign_start`, pg.`campaign_end`, pg.`created_at`, pg.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `coupon_campaign`
            WHERE `project_id` = i_project_id
              AND (i_status IS NULL OR `status` = i_status)
              AND (i_approval_status IS NULL OR `approval_status` = i_approval_status)
              AND (i_generation_status IS NULL OR `generation_status` = i_generation_status)
              AND (i_code_type IS NULL OR `code_type` = i_code_type)
        ) cnt
        LEFT JOIN (
            SELECT
                `coupon_campaign_id`, `project_id`, `name`, `code_type`,
                `requested_qty`, `generated_qty`, `generation_status`,
                `usable_qty`, `used_qty`, `status`, `approval_status`,
                `campaign_start`, `campaign_end`, `created_at`, `updated_at`
            FROM `coupon_campaign`
            WHERE `project_id` = i_project_id
              AND (i_status IS NULL OR `status` = i_status)
              AND (i_approval_status IS NULL OR `approval_status` = i_approval_status)
              AND (i_generation_status IS NULL OR `generation_status` = i_generation_status)
              AND (i_code_type IS NULL OR `code_type` = i_code_type)
            ORDER BY `status` DESC, `created_at` DESC
            LIMIT i_page_size OFFSET i_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_CAMPAIGN_REJECT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_REJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_REJECT` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 반려할 캠페인 ID
    IN i_reject_reason      VARCHAR(500),     -- 반려 사유
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 반려 - OPERATOR 반려불가(20001), approval_status 2->4 조건부 UPDATE (17_CAMPAIGN_API.md 2.7)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_REJECT
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : SP_CAMPAIGN_APPROVE와 동일한 존재확인/스코핑+승인권한 재검증 패턴이며, 승인 대신
    --        반려(approval_status=4) + reject_reason 기록만 다르다(17_CAMPAIGN_API.md 2.7).
    --        반려 후 재상신은 별도 API 없이 SP_CAMPAIGN_UPDATE 호출 시 그 SP의 OPERATOR 재승인
    --        규칙에 의해 approval_status가 2(승인대기)로 자동 재전환된다(17_CAMPAIGN_API.md 2.7
    --        Business Rules).
    --        log_coupon_campaign(action=50 REJECT) 기록은 SP_CAMPAIGN_CREATE와 동일한 이유로
    --        이 SP가 직접 하지 않는다 - 반환 행 전체를 TS 서비스가
    --        SP_LOG_COUPON_CAMPAIGN_CREATE(로그 DB)에 그대로 전달한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_role        TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_project_id  BIGINT UNSIGNED  DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id
        ) THEN
            SELECT 31004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `project_id` INTO v_project_id
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

        IF FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SET v_role = 10;
        ELSE
            SET v_role = FN_GET_PROJECT_ROLE_CODE(i_requester_user_id, v_project_id);
        END IF;

        IF v_role IS NULL OR v_role > 30 THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `coupon_campaign`
        SET
            `approval_status` = 4,
            `approved_by`      = i_requester_user_id,
            `approved_at`      = NOW(),
            `reject_reason`    = i_reject_reason,
            `updated_by`       = i_requester_user_id
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `approval_status` = 2
          AND `status` <> 4;

        IF ROW_COUNT() = 0 THEN
            SELECT 30004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_CAMPAIGN_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_UPDATE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 수정할 캠페인 ID
    IN i_updated_at         DATETIME,         -- 낙관적 동시성 제어 토큰(2.3 조회 시 받은 updated_at 그대로)
    IN i_name               VARCHAR(100),     -- 새 캠페인명 (NULL이면 미변경)
    IN i_campaign_start     DATETIME,         -- 새 시작일시 (NULL이면 미변경)
    IN i_campaign_end       DATETIME,         -- 새 종료일시 (NULL이면 미변경)
    IN i_use_limit_per_user INT UNSIGNED,     -- 새 재사용 허용 횟수 (NULL이면 미변경)
    IN i_usable_qty         INT UNSIGNED,     -- 새 실제 사용가능 수량 (NULL이면 미변경)
    IN i_reward_data        JSON,             -- 새 보상 내용 (NULL이면 미변경)
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 수정 - updated_at 낙관적 락 + status/수량/날짜 검증을 UPDATE 하나로 원자 처리 (17_CAMPAIGN_API.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_UPDATE
    -- 작성 : 2026.07.20 trisakion
    -- 수정 : 2026.07.20 trisakion — read-then-update(check-then-act) 방식이 레이스 윈도우를
    --        남긴다는 리뷰 지적을 받아, 검증+수정을 UPDATE 문 하나의 SET/WHERE절 안에서 원자적으로
    --        처리하도록 재작성. 사용자가 "승인자가 본 updated_at과 다르면 거부하면 되지 않냐"고
    --        제안해 낙관적 동시성 제어(optimistic concurrency)를 채택 — coupon_campaign.updated_at
    --        은 모든 수정 시 자동 갱신되므로 별도 버전 컬럼 없이 이 값 하나로 "그 사이 변경 여부"를
    --        판별한다(17_CAMPAIGN_API.md 2.4 Concurrency). 다만 이 낙관적 락은 "그 사이 아무것도
    --        안 바뀌었는지"만 보장할 뿐 값 자체의 유효성(상태/수량/날짜)은 별개로 여전히 검증해야
    --        하므로 두 가지를 같은 WHERE절에 함께 둔다(클라이언트를 신뢰하지 않는다는 02_DEV_
    --        CONVENTIONS.md 3.2와 같은 원칙 — 낙관적 락 통과가 값 검증을 대신하지 않음).
    -- 내용 : coupon_campaign_id/project_id/code_type/use_hyphen/requested_qty/generated_qty/
    --        generation_status/generation_error/used_qty/status/approval_status류는 이 SP의
    --        파라미터에 아예 없다 - 수정 불가 필드라 애초에 받지 않는다(17_CAMPAIGN_API.md 2.4
    --        Non-Updatable Fields, status는 2.5 전용, approval_status는 2.6/2.7 전용). 단
    --        approval_status/status는 아래 OPERATOR 재승인 규칙에 의해 부수효과로 바뀔 수 있다.
    --        존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_GET_PROJECT_ROLE_CODE, 20001)까지는
    --        기존과 동일하게 사전에 처리한다(프로젝트 배정은 시간이 지나도 안 바뀌는 값이라 이
    --        단계엔 레이스가 없다). 그 다음 단 하나의 UPDATE로:
    --          WHERE: coupon_campaign_id 일치 AND updated_at 일치(낙관적 락) AND status<>4(1.3)
    --                 AND (usable_qty 미지정 OR usable_qty<=generated_qty) AND campaign_end>campaign_start
    --          SET  : OPERATOR 재승인/강제일시중지 로직을 status/approval_status 컬럼을 직접
    --                 참조하는 IF(...)로 계산
    --        를 원자적으로 처리한다. ROW_COUNT()=0이면 위 조건 중 무엇이 깨졌는지 재조회로 진단해
    --        30005(충돌)/30004(종료)/30003(수량·날짜) 중 하나로 답한다 - SP_USER_APPROVE/REJECT의
    --        "실패 후 재조회로 사유 진단" 패턴과 동일하다.
    --        SET절 순서 주의: MySQL은 단일 테이블 UPDATE의 SET절을 왼쪽부터 순서대로 평가하며,
    --        뒤에 오는 표현식은 앞에서 이미 갱신된 값을 본다(예: `SET a=a+1, b=a`면 b는 새 a값을
    --        본다 - MySQL 공식 문서). `status` 계산이 `approval_status`의 "원래 값"을 봐야 하므로
    --        `status =` 절을 `approval_status =` 절보다 반드시 먼저 둔다 - 순서를 바꾸면 강제
    --        일시중지 조건이 항상 거짓으로 평가되는 조용한 버그가 된다.
    --        OPERATOR 재승인 규칙(2.4 Business Rules): 호출자 role_code가 이 프로젝트에서 40
    --        (OPERATOR)이고 수정 직전 approval_status가 3(승인완료)/4(반려)였다면, 수정과 동시에
    --        approval_status=2(승인대기)로 재전환한다 - OPERATOR는 승인권한이 없어 이미 승인된
    --        내용을 승인 절차 없이 바꾸는 우회를 막기 위함. 이때 status가 2(활성)였다면 함께
    --        3(일시중지)로 강제 전환한다(미승인 내용이 활성 서비스로 계속 노출되는 상황 방지).
    --        role_code<=30(승인권한 role)의 수정은 이 규칙이 발동하지 않고 즉시 그대로 반영된다.
    --        log_coupon_campaign(action=20 UPDATE) 기록은 이 SP가 직접 하지 않는다 - 반환 행
    --        전체를 TS 서비스가 SP_LOG_COUPON_CAMPAIGN_CREATE(로그 DB)에 그대로 전달한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_role                 TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_project_id           BIGINT UNSIGNED  DEFAULT NULL;
    DECLARE v_check_updated_at     DATETIME         DEFAULT NULL;
    DECLARE v_check_status         TINYINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id
        ) THEN
            SELECT 31004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `project_id` INTO v_project_id
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

        IF FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SET v_role = 10;
        ELSE
            SET v_role = FN_GET_PROJECT_ROLE_CODE(i_requester_user_id, v_project_id);
            IF v_role IS NULL THEN
                SELECT 20001 AS RESULT;
                LEAVE proc_block;
            END IF;
        END IF;

        UPDATE `coupon_campaign`
        SET
            `status`             = IF(
                v_role = 40 AND `approval_status` IN (3, 4) AND `status` = 2, 3, `status`
            ),
            `approval_status`    = IF(v_role = 40 AND `approval_status` IN (3, 4), 2, `approval_status`),
            `name`               = COALESCE(i_name, `name`),
            `campaign_start`     = COALESCE(i_campaign_start, `campaign_start`),
            `campaign_end`       = COALESCE(i_campaign_end, `campaign_end`),
            `use_limit_per_user` = COALESCE(i_use_limit_per_user, `use_limit_per_user`),
            `usable_qty`         = COALESCE(i_usable_qty, `usable_qty`),
            `reward_data`        = COALESCE(i_reward_data, `reward_data`),
            `updated_by`         = i_requester_user_id
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `updated_at` = i_updated_at
          AND `status` <> 4
          AND (i_usable_qty IS NULL OR i_usable_qty <= `generated_qty`)
          AND COALESCE(i_campaign_end, `campaign_end`) > COALESCE(i_campaign_start, `campaign_start`);

        IF ROW_COUNT() = 0 THEN
            SELECT `updated_at`, `status` INTO v_check_updated_at, v_check_status
            FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

            IF v_check_updated_at <> i_updated_at THEN
                SELECT 30005 AS RESULT;
            ELSEIF v_check_status = 4 THEN
                SELECT 30004 AS RESULT;
            ELSE
                SELECT 30003 AS RESULT;
            END IF;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;


-- ============================================================================================================ --
-- SP_COMPANY_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_CREATE` (
    IN i_company_code      VARCHAR(20),      -- 회사 코드 (전역 UNIQUE)
    IN i_company_name      VARCHAR(100),     -- 회사명
    IN i_description       VARCHAR(1000),    -- 설명 (선택)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '회사 생성 - SUPER_ADMIN 재검증, company_code 중복 확인 후 INSERT (10_COMPANY_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 생성. company_code 중복을 사전 체크(32001)한 뒤 INSERT한다. SP_USER_SIGNUP과
    --        동일한 이유로 사전 체크는 원자적이지 않으므로(동시에 같은 code로 두 요청이 들어오면
    --        둘 다 통과할 수 있음), INSERT의 UNIQUE 제약 위반(1062) 전용 핸들러를 백스톱으로 둔다.
    --        회사 관리메뉴는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 호출자가 실제 DB상 SUPER_ADMIN인지 재확인한다(방어적 이중
    --        체크, 02_DEV_CONVENTIONS.md 3.2) - 다른 검증보다 가장 먼저 확인한다.
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 결과 SELECT에 after_json/requester_name을
    --        추가했다 - 로그 DB는 물리적으로 분리돼 있어 이 SP가 직접 기록할 수 없으므로, TS
    --        서비스가 이 값을 그대로 SP_LOG_AUDIT_CREATE(로그 DB)에 전달한다(before_json은 CREATE라
    --        NULL). requester_name은 JWT 페이로드에 user_name이 없어 여기서 user 테이블을 직접
    --        조회해 채운다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_company_id  BIGINT       DEFAULT NULL;

    -- company_code 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (SELECT 1 FROM `company` WHERE `company_code` = i_company_code) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `company` (`company_code`, `company_name`, `description`)
        VALUES (i_company_code, i_company_name, i_description);

        SET v_company_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `company_id`, `company_code`, `company_name`, `description`,
            `status`, `created_at`, `updated_at`,
            JSON_OBJECT(                    -- after_json: log_audit 스냅샷(13_LOG_AUDIT_API.md)
                'company_id', `company_id`, 'company_code', `company_code`,
                'company_name', `company_name`, 'description', `description`,
                'status', `status`, 'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `company`
        WHERE `company_id` = v_company_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_GET_ACTIVE_HEADER_DATA
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_ACTIVE_HEADER_DATA`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_ACTIVE_HEADER_DATA` (
    IN i_user_id    BIGINT UNSIGNED,  -- 요청자 user_id (JWT 페이로드 값 그대로 신뢰)
    IN i_role_code  TINYINT UNSIGNED, -- 요청자 role_code (JWT 페이로드 값 그대로 신뢰)
    IN i_company_id BIGINT UNSIGNED   -- 요청자 소속 company_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '헤더 콤보박스용 활성 회사/프로젝트 조회 (10_COMPANY_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_ACTIVE_HEADER_DATA
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인 직후 헤더 콤보박스가 1회 로드하는 활성 회사·프로젝트 목록.
    --        role_code=10(SUPER_ADMIN)이면 전체 활성 회사+프로젝트, 그 외에는 본인 소속 회사 1건과
    --        user_role에 활성 배정(status=1)된 프로젝트만 반환한다 — 같은 회사 소속이어도 role
    --        미배정 프로젝트는 제외한다(10_COMPANY_API.md 3.1 Business Rules).
    --        role_code/company_id는 JwtAuthGuard가 검증한 JWT 페이로드 값을 그대로 신뢰하고 DB를
    --        재조회하지 않는다(jwt-auth.guard.ts와 같은 원칙, 로그인/재발급 시점에만 재계산됨).
    --        02_DEV_CONVENTIONS.md 3.4의 RESULT SELECT 규약은 RESULT + data 정확히 2개 result set만
    --        허용하므로, company/project를 각각 별도 result set으로 반환하는 대신 row_type
    --        판별 컬럼('COMPANY'/'PROJECT')으로 하나의 result set에 함께 담는다 — 서비스 레이어
    --        (company.service.ts)에서 row_type으로 다시 분리해 {companies, projects} 형태로 조립한다.
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

    IF i_role_code = 10 THEN
        SELECT 'COMPANY' AS row_type, `company_id` AS id, `company_id` AS company_id, `company_name` AS name
        FROM `company`
        WHERE `status` = 1
        UNION ALL
        SELECT 'PROJECT' AS row_type, `project_id` AS id, `company_id` AS company_id, `project_name` AS name
        FROM `project`
        WHERE `status` = 1;
    ELSE
        SELECT 'COMPANY' AS row_type, `company_id` AS id, `company_id` AS company_id, `company_name` AS name
        FROM `company`
        WHERE `company_id` = i_company_id AND `status` = 1
        UNION ALL
        SELECT 'PROJECT' AS row_type, p.`project_id` AS id, p.`company_id` AS company_id, p.`project_name` AS name
        FROM `project` p
        INNER JOIN `user_role` ur ON ur.`project_id` = p.`project_id`
        WHERE ur.`user_id` = i_user_id AND ur.`status` = 1 AND p.`status` = 1;
    END IF;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_GET_BY_CODE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_BY_CODE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_BY_CODE` (
    IN i_company_code VARCHAR(20)  -- 조회할 회사 코드
) COMMENT '회사 코드로 조회 - 회원가입 화면 전용 공개 API (10_COMPANY_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_BY_CODE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회원가입 화면(로그인 전, 인증 불필요)에서 company_code로 회사를 찾기 위한 공개 조회.
    --        status=1(사용)인 회사만 대상으로 하고, company_id/company_name만 반환한다 —
    --        민감정보(description 등)는 노출하지 않는다. 없거나 비활성이면 31001.
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
        IF NOT EXISTS (
            SELECT 1 FROM `company` WHERE `company_code` = i_company_code AND `status` = 1
        ) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `company_id`, `company_name`
        FROM `company`
        WHERE `company_code` = i_company_code AND `status` = 1;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_BY_ID` (
    IN i_company_id        BIGINT UNSIGNED,  -- 조회할 회사 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '회사 상세 조회 - SUPER_ADMIN 재검증 (10_COMPANY_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id로 회사 상세를 조회한다. 없으면 31001. 회사 관리메뉴는 SUPER_ADMIN
    --        전용이라 RolesGuard가 이미 막고 있지만, 이 SP도 FN_IS_SUPER_ADMIN으로 재확인한다
    --        (방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
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
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `company_id`, `company_code`, `company_name`, `description`,
            `status`, `created_at`, `updated_at`
        FROM `company`
        WHERE `company_id` = i_company_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_LIST` (
    IN i_status            TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_page_size         INT,               -- 페이지당 행 수
    IN i_offset            INT,               -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED    -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '회사 목록 조회 - SUPER_ADMIN 재검증, 페이지네이션 (10_COMPANY_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 목록을 status DESC, company_name ASC로 정렬해 페이지 단위로 반환한다.
    --        02_DEV_CONVENTIONS.md 3.4의 RESULT SELECT 규약은 RESULT + data 정확히 2개 result set만
    --        허용하므로, 별도의 COUNT(*) 쿼리를 셋째 result set으로 추가할 수 없다. 다만 total_count를
    --        페이지네이션 대상 SELECT에 COUNT(*) OVER()로 얹으면, 요청한 offset이 실제 데이터
    --        범위를 벗어나 0행이 반환되는 경우 total_count도 함께 사라져 0으로 잘못 응답되는
    --        문제가 있다(2026-07-19 감사에서 발견). 이를 막기 위해 총 개수를 별도 서브쿼리로 항상
    --        1행 계산해두고, 페이지네이션 서브쿼리를 LEFT JOIN ... ON TRUE로 붙인다 — 페이지네이션
    --        결과가 0행이어도 총 개수 행은 NULL 데이터 컬럼과 함께 보존된다(앱 레이어는 PK 컬럼이
    --        NULL인 행을 데이터 없음으로 취급하고 total_count만 읽는다). 페이지네이션이 필요한 다른
    --        목록 SP(project/user 등)도 이 패턴을 그대로 재사용한다.
    --        회사 관리메뉴는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 재확인한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
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
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`company_id`, p.`company_code`, p.`company_name`, p.`description`,
            p.`status`, p.`created_at`, p.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `company`
            WHERE i_status IS NULL OR `status` = i_status
        ) cnt
        LEFT JOIN (
            SELECT `company_id`, `company_code`, `company_name`, `description`, `status`, `created_at`, `updated_at`
            FROM `company`
            WHERE i_status IS NULL OR `status` = i_status
            ORDER BY `status` DESC, `company_name` ASC
            LIMIT i_page_size OFFSET i_offset
        ) p ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_UPDATE` (
    IN i_company_id        BIGINT UNSIGNED,  -- 수정할 회사 ID
    IN i_company_code      VARCHAR(20),      -- 새 회사 코드 (NULL이면 미변경)
    IN i_company_name      VARCHAR(100),     -- 새 회사명 (NULL이면 미변경)
    IN i_description       VARCHAR(1000),    -- 새 설명 (NULL이면 미변경)
    IN i_status            TINYINT UNSIGNED, -- 새 상태 (NULL이면 미변경)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '회사 수정 - SUPER_ADMIN 재검증, 조건부 UPDATE (10_COMPANY_API.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 정보 수정. 존재 확인(31001) -> company_code 변경 시 중복 확인(자기 자신 제외, 32001)
    --        -> COALESCE 기반 조건부 UPDATE(02_DEV_CONVENTIONS.md 4장)로 NULL로 넘어온 필드는 기존
    --        값을 유지한다. 관리자 폼이 매번 전체 필드를 채워 보내는 단순 CRUD라 "필드를 명시적으로
    --        NULL로 비우는" 시나리오까지는 다루지 않는다(description을 지우고 싶으면 빈 문자열을
    --        보내는 것으로 충분 — 실제 NULL 저장이 필요해지면 그때 별도 플래그를 추가한다).
    --        SP_COMPANY_CREATE와 동일한 이유로, 사전 중복확인 -> UPDATE 사이에 다른 트랜잭션이
    --        같은 company_code로 끼어드는 경쟁 상태에 대비해 UNIQUE 제약 위반(1062) 백스톱
    --        핸들러를 둔다(2026-07-19 리뷰에서 CREATE에만 있고 UPDATE에는 없던 것을 발견).
    --        회사 관리메뉴는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다 - 캡처와
    --        UPDATE 사이에 이론상 레이스 윈도우가 있지만(관리콘솔 저빈도 트래픽이라 실무 영향 미미),
    --        TS 레이어가 별도로 조회하는 방식(레이스 + user_role 등 일부 도메인은 단건 조회 SP
    --        자체가 없어 신규 필요)보다 원자적이라 이 방식을 택했다(02_DEV_CONVENTIONS.md 3.2와
    --        같은 "DB가 최종 방어선/근원" 원칙).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    -- company_code 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF i_company_code IS NOT NULL AND EXISTS (
            SELECT 1 FROM `company`
            WHERE `company_code` = i_company_code AND `company_id` <> i_company_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷(log_audit용)
            'company_id', `company_id`, 'company_code', `company_code`,
            'company_name', `company_name`, 'description', `description`,
            'status', `status`, 'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `company` WHERE `company_id` = i_company_id;

        UPDATE `company`
        SET
            `company_code` = COALESCE(i_company_code, `company_code`),
            `company_name` = COALESCE(i_company_name, `company_name`),
            `description`  = COALESCE(i_description, `description`),
            `status`       = COALESCE(i_status, `status`)
        WHERE `company_id` = i_company_id;

        SELECT 0 AS RESULT;
        SELECT
            `company_id`, `company_code`, `company_name`, `description`,
            `status`, `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'company_id', `company_id`, 'company_code', `company_code`,
                'company_name', `company_name`, 'description', `description`,
                'status', `status`, 'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `company`
        WHERE `company_id` = i_company_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_NONCE_INSERT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_NONCE_INSERT`;
DELIMITER $$
CREATE PROCEDURE `SP_NONCE_INSERT` (
    IN i_project_id BIGINT UNSIGNED,  -- 인증된 project_id (project.project_id)
    IN i_nonce      VARCHAR(64)       -- X-API-Nonce 헤더 원문
) COMMENT 'S2S nonce 원자적 등록 — UNIQUE 위반이면 재전송으로 판단해 10015 반환(docs/07_AUTH_SECURITY.md 2.4 6번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_NONCE_INSERT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : S2S 인증 가드(docs/07_AUTH_SECURITY.md 2.4 6번)의 재전송 방지 nonce 등록.
    --        (project_id, nonce) UNIQUE 제약 위반을 "이미 사용된 nonce(재전송 의심)"으로 판단해 10015를
    --        반환한다. 02_DEV_CONVENTIONS.md 3.4는 "예측 가능한 실패는 예외로 던지지 않는다"는 원칙이지만
    --        이 SP는 의도적 예외다 — INSERT 자체의 원자적 유니크 제약 위반을 이용해야만 동시에 같은 nonce가
    --        들어와도 정확히 하나만 성공시킬 수 있다(체크 후 INSERT는 두 요청이 동시에 통과하는 경쟁 상태를
    --        막지 못함, docs/07_AUTH_SECURITY.md 2.5 참고).
    --        MySQL은 여러 핸들러가 매치될 때 선언 순서와 무관하게 더 구체적인 조건(mysql_errno)을
    --        SQLEXCEPTION 같은 범용 조건보다 우선 적용하므로, 1062 전용 핸들러가 항상 먼저 걸린다 —
    --        아래에서 먼저 선언한 것은 가독성을 위한 것일 뿐, 동작상 필수는 아니다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    -- 유니크 제약(재전송) 전용 핸들러 — mysql_errno 1062(ER_DUP_ENTRY)
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 10015 AS RESULT;
    END;

    -- 그 외 예측 못한 시스템 오류
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    INSERT INTO `project_api_nonce` (`project_id`, `nonce`)
    VALUES (i_project_id, i_nonce);

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_API_SECRET_CLEANUP
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_API_SECRET_CLEANUP`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_API_SECRET_CLEANUP` (
    IN i_grace_period_days INT UNSIGNED  -- 유예기간(일) — API_SECRET_GRACE_PERIOD_DAYS
) COMMENT '유예기간 지난 api_secret_prev 정리 배치 (07_AUTH_SECURITY.md 2.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_API_SECRET_CLEANUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : Secret Rotation Grace Period 방식(07_AUTH_SECURITY.md 2.6)의 정리 배치.
    --        secret_rotated_at + i_grace_period_days가 지난 행의 api_secret_prev를 NULL
    --        처리한다 — 그 이후에는 이전 Secret으로 서명해도 더 이상 통과시키지 않는다
    --        (S2sAuthGuard.verifySignature가 api_secret_prev가 NULL이면 아예 후보에서 제외).
    --        SP_SESSION_CLEANUP과 동일하게 서버 기동 시 ApiSecretCleanupService가 크론으로 호출한다.
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

    UPDATE `project`
    SET `api_secret_prev` = NULL
    WHERE `api_secret_prev` IS NOT NULL
      AND `secret_rotated_at` IS NOT NULL
      AND `secret_rotated_at` <= NOW() - INTERVAL i_grace_period_days DAY;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_API_SECRET_ROTATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_API_SECRET_ROTATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_API_SECRET_ROTATE` (
    IN i_project_id      BIGINT UNSIGNED,  -- 재발급 대상 프로젝트 ID
    IN i_user_id         BIGINT UNSIGNED,  -- 요청자 user_id (JWT 페이로드 값 그대로 신뢰)
    IN i_new_api_secret_enc VARCHAR(255)   -- 새 API Secret AES-256-CBC 암호화값 (앱 레이어에서 암호화 완료)
) COMMENT 'API Secret 재발급 - Grace Period 방식 (11_PROJECT_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_API_SECRET_ROTATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 존재 확인(31002) 후, FN_IS_SUPER_ADMIN(i_user_id)이 아니면 FN_CHECK_PROJECT_ACCESS로
    --        해당 project_id에 실제 활성 user_role 배정이 있는지 재검증한다(11_PROJECT_API.md 2.5
    --        Business Rules — JWT의 role_code는 여러 프로젝트 중 최고 권한 하나뿐이라 이 project_id
    --        기준으로는 다시 확인해야 함). 원래는 앱이 전달한 i_role_code로 SUPER_ADMIN 우회를
    --        판단했으나, 02_DEV_CONVENTIONS.md 3.2 정책(SP는 호출자의 role_code 값을 앱으로부터
    --        전달받아 신뢰하지 않는다) 전면 적용 때 이 SP만 누락돼 있던 것을 2026-07-19 감사에서
    --        발견해 FN_IS_SUPER_ADMIN 재확인으로 교체했다(API Secret 재발급은 보안 민감 기능이라
    --        다른 SP보다 오히려 더 엄격해야 함). 통과하면 기존 api_secret을 api_secret_prev로 옮기고
    --        신규 값을 api_secret에 저장, secret_rotated_at을 갱신한다(07_AUTH_SECURITY.md 2.6
    --        Grace Period 방식). api_key는 변경하지 않는다. 반환 컬럼에 api_secret(암호문)은
    --        포함하지 않는다 — 평문은 앱 레이어가 자신이 생성한 값을 응답에 직접 얹는다.
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 company_id/project_name(스코핑/표시명용)과
    --        before_json/after_json/requester_name을 추가했다. api_secret/api_secret_prev는
    --        '***'로 마스킹한다(13_LOG_AUDIT_API.md 2.4).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT FN_IS_SUPER_ADMIN(i_user_id) AND NOT FN_CHECK_PROJECT_ACCESS(i_user_id, i_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷(api_secret류 마스킹)
            'project_id', `project_id`, 'company_id', `company_id`,
            'project_code', `project_code`, 'project_name', `project_name`,
            'description', `description`, 'api_key', `api_key`,
            'api_secret', '***',
            'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
            'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `project` WHERE `project_id` = i_project_id;

        UPDATE `project`
        SET
            `api_secret_prev`   = `api_secret`,
            `api_secret`        = i_new_api_secret_enc,
            `secret_rotated_at` = NOW()
        WHERE `project_id` = i_project_id;

        SELECT 0 AS RESULT;
        SELECT
            `project_id`, `company_id`, `project_name`, `secret_rotated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'project_id', `project_id`, 'company_id', `company_id`,
                'project_code', `project_code`, 'project_name', `project_name`,
                'description', `description`, 'api_key', `api_key`,
                'api_secret', '***',
                'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
                'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_user_id) AS requester_name
        FROM `project`
        WHERE `project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_CREATE` (
    IN i_company_id        BIGINT UNSIGNED,  -- 소속 회사 ID
    IN i_project_code      VARCHAR(20),      -- 프로젝트 코드 (company_id 범위 내 UNIQUE)
    IN i_project_name      VARCHAR(100),     -- 프로젝트명
    IN i_description       VARCHAR(1000),    -- 설명 (선택)
    IN i_api_key           VARCHAR(64),      -- 서버간 호출용 API Key (앱 레이어에서 생성)
    IN i_api_secret_enc    VARCHAR(255),     -- API Secret AES-256-CBC 암호화값 (앱 레이어에서 암호화 완료)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 생성 - SUPER_ADMIN 재검증, api_key/api_secret 발급 후 INSERT (11_PROJECT_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 생성. company_id 존재(31001) 확인 후 company_id 범위 내 project_code
    --        중복(32001)을 사전 체크한 뒤 INSERT한다. api_key/api_secret은 이미 앱 레이어
    --        (ProjectService)에서 생성/암호화가 끝난 값을 그대로 저장한다 — SP는 암호화 로직을
    --        모른다(SP_USER_SIGNUP과 동일한 원칙). 사전 체크는 원자적이지 않으므로 INSERT의
    --        UNIQUE 제약 위반(1062, project_code 또는 api_key 어느 쪽이든)도 32001로 통일해
    --        백스톱한다 — api_key는 256비트 난수라 충돌 가능성이 사실상 0에 가까워 별도 코드로
    --        구분하지 않는다.
    --        반환 컬럼에 api_secret(암호문)은 포함하지 않는다 — 앱으로 다시 내보낼 이유가 없고,
    --        평문은 서비스 레이어가 자신이 생성한 값을 응답에 직접 얹는다.
    --        프로젝트 생성은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 결과 SELECT에 after_json/requester_name을
    --        추가했다(before_json은 CREATE라 NULL). after_json 안의 api_secret/api_secret_prev는
    --        암호문이라도 ENCRYPTION_KEY 유출 시 복호화가 가능해 password_hash와 동일 수준으로
    --        '***' 마스킹한다(13_LOG_AUDIT_API.md 2.4).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT       DEFAULT NULL;

    -- project_code/api_key 유니크 제약 위반(경쟁 상태 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (
            SELECT 1 FROM `project`
            WHERE `company_id` = i_company_id AND `project_code` = i_project_code
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `project` (
            `company_id`, `project_code`, `project_name`, `description`, `api_key`, `api_secret`
        ) VALUES (
            i_company_id, i_project_code, i_project_name, i_description, i_api_key, i_api_secret_enc
        );

        SET v_project_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `project_id`, `company_id`, `project_code`, `project_name`, `description`,
            `api_key`, `status`, `created_at`, `updated_at`,
            JSON_OBJECT(                    -- after_json: log_audit 스냅샷(api_secret류 마스킹)
                'project_id', `project_id`, 'company_id', `company_id`,
                'project_code', `project_code`, 'project_name', `project_name`,
                'description', `description`, 'api_key', `api_key`,
                'api_secret', '***',
                'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
                'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `project`
        WHERE `project_id` = v_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_GET_BY_API_KEY
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_API_KEY`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_API_KEY` (
    IN i_api_key VARCHAR(64)  -- 조회할 API Key (project.api_key)
) COMMENT 'API Key로 project 조회 (S2S 인증 가드 전용, docs/07_AUTH_SECURITY.md 2.4 3~4번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_API_KEY
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : S2S 인증 가드(docs/07_AUTH_SECURITY.md 2.4 3~4번)가 X-API-Key로 project를 조회할 때 사용.
    --        RESULT SELECT 규약(docs/02_DEV_CONVENTIONS.md 3.4)을 따른다 — 첫 SELECT는 RESULT 단일 행,
    --        성공(0)일 때만 두 번째 SELECT로 project 행(암호화된 api_secret/api_secret_prev 포함)을 반환한다.
    --        프로젝트 상태(status=0 중지)는 이 SP에서 판단하지 않는다 — "코드 없음(31002)"과
    --        "상태 불가(10014)"는 서로 다른 result 코드라, 조회 자체는 그대로 성공시키고 상태 확인은
    --        가드 쪽에서 조회된 값을 보고 별도로 매핑한다.
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
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `api_key` = i_api_key) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `project_id`,
            `status`,
            `api_secret`,
            `api_secret_prev`,
            `secret_rotated_at`
        FROM `project`
        WHERE `api_key` = i_api_key;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_GET_BY_CODE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_CODE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_CODE` (
    IN i_company_id   BIGINT UNSIGNED,  -- 조회할 회사 ID
    IN i_project_code VARCHAR(20)       -- 조회할 프로젝트 코드
) COMMENT '회사 범위 내 프로젝트 코드로 조회 - 회원가입 화면 전용 공개 API (11_PROJECT_API.md 2.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_CODE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회원가입 화면(로그인 전, 인증 불필요)에서 (company_id, project_code)로 프로젝트를
    --        찾기 위한 공개 조회. status=1(사용)인 것만 대상으로 하고, project_id/project_name만
    --        반환한다(민감정보 없음). 없거나 비활성이면 31002.
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
        IF NOT EXISTS (
            SELECT 1 FROM `project`
            WHERE `company_id` = i_company_id AND `project_code` = i_project_code AND `status` = 1
        ) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `project_id`, `project_name`
        FROM `project`
        WHERE `company_id` = i_company_id AND `project_code` = i_project_code AND `status` = 1;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_ID` (
    IN i_project_id        BIGINT UNSIGNED,  -- 조회할 프로젝트 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 상세 조회 - company 조인, 회사 접근 재검증 (11_PROJECT_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : project_id로 프로젝트 상세를 조회한다. company_code/company_name을 함께 반환하기
    --        위해 company를 조인한다. 없으면 31002. DEVELOPER의 타사 프로젝트 접근 차단(20001)은
    --        앱 레이어(ProjectService)가 조회 결과의 company_id를 요청자의 companyId와 비교해
    --        1차로 판단하고, 이 SP도 FN_CHECK_COMPANY_ACCESS로 호출자가 실제 그 프로젝트의 회사
    --        소속인지 2차로 재검증한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2). 존재 확인이
    --        먼저이고(31002), 그 다음 접근 재검증(20001) 순서다 - 없는 리소스는 권한 여부와
    --        무관하게 항상 404가 맞다. SUPER_ADMIN 우회는 FN_IS_SUPER_ADMIN(i_requester_user_id)로
    --        SP가 직접 DB에서 재확인한다 - 앱이 넘긴 role_code 값을 그대로 믿지 않는다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_company_id  BIGINT UNSIGNED DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SELECT `company_id` INTO v_company_id FROM `project` WHERE `project_id` = i_project_id;

        IF v_company_id IS NULL THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_COMPANY_ACCESS(i_requester_user_id, v_company_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
            p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
            p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`
        FROM `project` p
        JOIN `company` c ON c.`company_id` = p.`company_id`
        WHERE p.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_LIST` (
    IN i_company_id        BIGINT UNSIGNED,   -- 회사 필터 (NULL이면 전체 — DEVELOPER 호출 시 앱 레이어가 자기 회사로 강제)
    IN i_status            TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_page_size         INT,               -- 페이지당 행 수
    IN i_offset            INT,               -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED    -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 목록 조회 - 페이지네이션, company 조인, 회사 접근 재검증 (11_PROJECT_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 목록을 status DESC, project_name ASC로 정렬해 페이지 단위로 반환한다.
    --        company_code/company_name을 함께 보여줘야 해서 company를 조인한다. DEVELOPER는
    --        본인 소속 company_id만 봐야 하는데(11_PROJECT_API.md 2.2 Business Rules), 그 스코핑은
    --        앱 레이어(ProjectService)가 i_company_id에 항상 자기 companyId를 채워 호출하는
    --        방식으로 1차 강제하고, 이 SP도 FN_CHECK_COMPANY_ACCESS로 호출자가 실제 그 회사
    --        소속인지 2차로 재검증한다(앱 레이어 버그로 잘못된 company_id가 넘어와도 SP가
    --        마지막 방어선 역할을 하도록, 02_DEV_CONVENTIONS.md 3.2). SUPER_ADMIN 우회는
    --        FN_IS_SUPER_ADMIN(i_requester_user_id)로 SP가 직접 DB에서 재확인한다 - 앱이
    --        role_code 값을 함께 넘겨 그 값을 그대로 믿는 방식은 쓰지 않는다(앱 레이어가 잘못된
    --        role_code를 실어 보내는 버그가 있어도 이 SP는 영향받지 않는다).
    --        total_count는 SP_COMPANY_LIST와 동일한 이유로 COUNT(*) OVER()가 아니라 별도 서브쿼리
    --        + LEFT JOIN ... ON TRUE 패턴으로 반환한다(offset이 범위를 벗어나 0행이 반환돼도
    --        total_count가 0으로 사라지지 않도록, 2026-07-19 감사에서 발견된 버그 수정).
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
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_COMPANY_ACCESS(i_requester_user_id, i_company_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            pg.`project_id`, pg.`company_id`, pg.`company_code`, pg.`company_name`,
            pg.`project_code`, pg.`project_name`, pg.`api_key`, pg.`description`,
            pg.`status`, pg.`secret_rotated_at`, pg.`created_at`, pg.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `project` p
            WHERE (i_company_id IS NULL OR p.`company_id` = i_company_id)
              AND (i_status IS NULL OR p.`status` = i_status)
        ) cnt
        LEFT JOIN (
            SELECT
                p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
                p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
                p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`
            FROM `project` p
            JOIN `company` c ON c.`company_id` = p.`company_id`
            WHERE (i_company_id IS NULL OR p.`company_id` = i_company_id)
              AND (i_status IS NULL OR p.`status` = i_status)
            ORDER BY p.`status` DESC, p.`project_name` ASC
            LIMIT i_page_size OFFSET i_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_UPDATE` (
    IN i_project_id        BIGINT UNSIGNED,  -- 수정할 프로젝트 ID
    IN i_project_name      VARCHAR(100),     -- 새 프로젝트명 (NULL이면 미변경)
    IN i_description       VARCHAR(1000),    -- 새 설명 (NULL이면 미변경)
    IN i_status            TINYINT UNSIGNED, -- 새 상태 (NULL이면 미변경)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 수정 - SUPER_ADMIN 재검증, 조건부 UPDATE (11_PROJECT_API.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 정보 수정. company_id/project_code/api_key/api_secret은 이 SP의 파라미터에
    --        아예 없다 — 생성 후 변경 불가 필드라 애초에 받지 않는다(11_PROJECT_API.md 2.4
    --        Non-Updatable Fields). 존재 확인(31002) -> COALESCE 기반 조건부 UPDATE
    --        (02_DEV_CONVENTIONS.md 4장)로 NULL로 넘어온 필드는 기존 값을 유지한다.
    --        프로젝트 수정은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다.
    --        api_secret/api_secret_prev는 이 SP가 건드리지 않는 필드지만 "전체 Row" 스냅샷
    --        원칙(13_LOG_AUDIT_API.md 2.3)상 JSON에 포함하고 '***'로 마스킹한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷(api_secret류 마스킹)
            'project_id', `project_id`, 'company_id', `company_id`,
            'project_code', `project_code`, 'project_name', `project_name`,
            'description', `description`, 'api_key', `api_key`,
            'api_secret', '***',
            'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
            'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `project` WHERE `project_id` = i_project_id;

        UPDATE `project`
        SET
            `project_name` = COALESCE(i_project_name, `project_name`),
            `description`  = COALESCE(i_description, `description`),
            `status`       = COALESCE(i_status, `status`)
        WHERE `project_id` = i_project_id;

        SELECT 0 AS RESULT;
        SELECT
            p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
            p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
            p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'project_id', p.`project_id`, 'company_id', p.`company_id`,
                'project_code', p.`project_code`, 'project_name', p.`project_name`,
                'description', p.`description`, 'api_key', p.`api_key`,
                'api_secret', '***',
                'api_secret_prev', IF(p.`api_secret_prev` IS NULL, NULL, '***'),
                'secret_rotated_at', p.`secret_rotated_at`, 'status', p.`status`,
                'created_at', p.`created_at`, 'updated_at', p.`updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `project` p
        JOIN `company` c ON c.`company_id` = p.`company_id`
        WHERE p.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_SESSION_CLEANUP
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_SESSION_CLEANUP`;
DELIMITER $$
CREATE PROCEDURE `SP_SESSION_CLEANUP` () COMMENT '만료 세션 물리 삭제 배치 (08_API_COMMON.md 5.4, SESSION_CLEANUP_CRON)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_SESSION_CLEANUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : expired_at이 현재 시각보다 과거인 세션을 status와 무관하게 물리 삭제한다.
    --        만료 기간 값(JWT_REFRESH_EXPIRES_IN) 자체를 몰라도 되도록 expired_at은 로그인 시점에
    --        이미 절대시각으로 저장돼 있어(SP_USER_SESSION_CREATE), NOW()와 비교만 하면 된다.
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

    DELETE FROM `user_session` WHERE `expired_at` < NOW();

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_APPROVE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_APPROVE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_APPROVE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 승인할 사용자 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '가입승인 - SUPER_ADMIN 재검증, status 0(대기) -> 1(승인) 조건부 UPDATE (12_USER_API.md 1.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_APPROVE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 조건부 UPDATE(WHERE status=0)를 먼저 시도해 체크 후 갱신(check-then-act) 대신
    --        원자적으로 처리한다(02_DEV_CONVENTIONS.md 4장). 영향받은 행이 0건일 때만 그 이유를
    --        진단한다 - 사용자 자체가 없으면 31003, 있는데 이미 status=0이 아니면(이미 처리됨)
    --        30004(상태 전이 불가)로 구분한다. 이렇게 하면 성공 경로(가장 흔한 경우)는 존재
    --        여부를 별도로 조회하지 않고 UPDATE 한 번으로 끝난다.
    --        가입승인은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고(대상이 없으면 SELECT...INTO가 조용히 NULL을 남길 뿐이라 안전 — 이후
    --        ROW_COUNT()=0 분기에서 어차피 LEAVE한다), 결과 SELECT에
    --        before_json/after_json/requester_name을 추가했다. password_hash는 '***'로 마스킹한다
    --        (13_LOG_AUDIT_API.md 2.4).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user` WHERE `user_id` = i_user_id;

        UPDATE `user`
        SET `status` = 1
        WHERE `user_id` = i_user_id AND `status` = 0;

        IF ROW_COUNT() = 0 THEN
            IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
                SELECT 31003 AS RESULT;
            ELSE
                SELECT 30004 AS RESULT;
            END IF;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', `user_id`, 'company_id', `company_id`,
                'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
                'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
                'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
                'status', `status`, 'last_login_at', `last_login_at`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_GET_BY_ID` (
    IN i_user_id           BIGINT UNSIGNED,  -- 조회할 사용자 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_id로 전체 컬럼 조회, 회사 접근 재검증 - GET /auth/me, 비밀번호 변경 시 현재 해시 조회, 관리자 상세조회 공용'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : GET /auth/me, PATCH /auth/password(현재 비밀번호 검증용 해시 조회), 관리자용
    --        GET /users/{user_id}(12_USER_API.md 1.3) 세 곳에서 공용으로 쓰는 조회 SP.
    --        password_hash를 포함해 전체 컬럼을 그대로 반환하며, API 응답에 어떤 필드를 노출할지
    --        (예: password_hash 제외, phone_number 복호화)는 서비스 레이어가 결정한다.
    --        i_requester_user_id는 자기 정보 조회(auth.service.ts)에서는 항상 i_user_id와 동일한
    --        값이 들어와 FN_CHECK_COMPANY_ACCESS가 자기 자신의 company_id와 비교하게 되므로
    --        결과적으로 항상 통과한다 - 자기 정보는 role과 무관하게 항상 볼 수 있어야 하므로 이는
    --        의도된 동작이다. 관리자 조회(user.service.ts)에서는 실제 호출자와 다른 대상 user_id가
    --        들어와, DEVELOPER가 타사 사용자를 조회하면 20001로 차단한다(12_USER_API.md 1.3,
    --        앱 레이어의 1차 체크를 SP가 2차로 재검증 - 02_DEV_CONVENTIONS.md 3.2). 존재 확인
    --        (31003)이 접근 재검증보다 먼저다 - 없는 리소스는 권한 여부와 무관하게 항상 404가
    --        맞다. SUPER_ADMIN 우회는 FN_IS_SUPER_ADMIN(i_requester_user_id)로 SP가 직접 DB에서
    --        재확인한다 - 앱이 role_code 값을 별도로 넘겨 그 값을 믿는 방식은 쓰지 않는다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_company_id  BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SELECT `company_id` INTO v_company_id FROM `user` WHERE `user_id` = i_user_id;

        IF v_company_id IS NULL THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_COMPANY_ACCESS(i_requester_user_id, v_company_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `password_hash`,
            `user_name`, `email`, `phone_number`, `department`, `position`, `status`,
            `last_login_at`, `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_GET_BY_LOGIN_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_GET_BY_LOGIN_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_GET_BY_LOGIN_ID` (
    IN i_login_id VARCHAR(100)  -- 로그인 ID
) COMMENT '로그인 처리 전용 - login_id로 user 조회, role_code(MIN, 미배정시 40)까지 함께 계산'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_GET_BY_LOGIN_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인(POST /auth/login) 처리용 사용자 조회. password_hash를 포함해 반환하므로
    --        앱 레이어가 bcrypt로 비교한다(SP는 비밀번호 검증 로직을 모른다).
    --        role_code는 user_session에 저장하지 않고 이 시점에 user_role을 조인해 계산한다
    --        (09_AUTH_API.md 7장 — 로그인/재발급 시점마다 동일한 방식으로 매번 재계산).
    --        login_id 자체가 없으면 10001(로그인 실패) — 비밀번호 불일치(10002)와는 앱 레이어에서 구분.
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
        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `login_id` = i_login_id) THEN
            SELECT 10001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            u.`user_id`, u.`company_id`, u.`requested_project_id`, u.`login_id`,
            u.`password_hash`, u.`user_name`, u.`email`, u.`phone_number`,
            u.`department`, u.`position`, u.`status`,
            COALESCE(MIN(ur.`role_code`), 40) AS role_code,
            u.`last_login_at`, u.`created_at`, u.`updated_at`
        FROM `user` u
        LEFT JOIN `user_role` ur ON u.`user_id` = ur.`user_id` AND ur.`status` = 1
        WHERE u.`login_id` = i_login_id
        GROUP BY
            u.`user_id`, u.`company_id`, u.`requested_project_id`, u.`login_id`,
            u.`password_hash`, u.`user_name`, u.`email`, u.`phone_number`,
            u.`department`, u.`position`, u.`status`,
            u.`last_login_at`, u.`created_at`, u.`updated_at`;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_LIST` (
    IN i_company_id        BIGINT UNSIGNED,  -- 회사 ID 필터 (NULL이면 전체 - SUPER_ADMIN 전용, DEVELOPER는 서비스가 항상 자기 회사로 고정)
    IN i_status            TINYINT UNSIGNED, -- 상태 필터 (NULL이면 전체)
    IN i_limit             INT,              -- 페이지당 행 수
    IN i_offset            INT,              -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '사용자 목록 조회 - status ASC 정렬, 회사 접근 재검증 (12_USER_API.md 1.1/1.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id/status 조건부 필터 + 페이지네이션. company.sql/project.sql과 동일하게
    --        별도 COUNT 서브쿼리 + LEFT JOIN ... ON TRUE로 total_count를 반환해 RESULT+data
    --        2-result-set 규약을 유지한다(COUNT(*) OVER()는 offset이 범위를 벗어나 0행이 반환되면
    --        total_count도 0으로 사라지는 버그가 있어 2026-07-19 이 패턴으로 교체).
    --        다른 테이블은 status DESC가 기본이지만 user는 "가입승인대기(0)"가 가장 먼저 보여야
    --        하는 화면 요구사항이 있어 status ASC로 정렬한다(12_USER_API.md 1.1 Sorting, 다른
    --        도메인과 다른 정렬 방향이라는 점을 주석으로 명시).
    --        password_hash는 반환 컬럼에서 제외한다 — 목록/상세 어디서도 앱으로 내보낼 이유가 없다.
    --        DEVELOPER의 회사 단위 스코핑은 앱 레이어(UserService)가 i_company_id에 항상 자기
    --        companyId를 채워 호출하는 방식으로 1차 강제하고, 이 SP도 FN_CHECK_COMPANY_ACCESS로
    --        호출자가 실제 그 회사 소속인지 2차로 재검증한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2). SUPER_ADMIN 우회는 FN_IS_SUPER_ADMIN(i_requester_user_id)로
    --        SP가 직접 DB에서 재확인한다 - 앱이 넘긴 role_code 값을 그대로 믿지 않는다.
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
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_COMPANY_ACCESS(i_requester_user_id, i_company_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`user_id`, p.`company_id`, p.`requested_project_id`, p.`login_id`, p.`user_name`, p.`email`,
            p.`phone_number`, p.`department`, p.`position`, p.`status`, p.`last_login_at`,
            p.`created_at`, p.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `user`
            WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
              AND (i_status IS NULL OR `status` = i_status)
        ) cnt
        LEFT JOIN (
            SELECT
                `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
                `phone_number`, `department`, `position`, `status`, `last_login_at`,
                `created_at`, `updated_at`
            FROM `user`
            WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
              AND (i_status IS NULL OR `status` = i_status)
            ORDER BY `status` ASC, `user_name` ASC
            LIMIT i_limit OFFSET i_offset
        ) p ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_PASSWORD_CHANGE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_PASSWORD_CHANGE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_PASSWORD_CHANGE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 대상 사용자 ID
    IN i_new_password_hash VARCHAR(255)       -- 새 비밀번호 bcrypt 해시(앱 레이어에서 해시 완료)
) COMMENT '비밀번호 변경 + 전체 활성 세션 강제 로그아웃 (09_AUTH_API.md 9장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_PASSWORD_CHANGE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 현재 비밀번호 검증(bcrypt.compare)은 앱 레이어에서 이미 끝난 상태로 호출된다.
    --        password_hash 갱신과 "모든 활성 세션 종료"(07_AUTH_SECURITY.md 1.3)를 하나의
    --        트랜잭션으로 처리해, 비밀번호는 바뀌었는데 기존 세션이 살아있는 상태가 생기지 않게 한다.
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 데이터 result set(before_json/after_json/requester_name)을 신규로 추가했다
    --        (13_LOG_AUDIT_API.md 2.4 — 본인 비밀번호 변경도 user UPDATE 감사 로그 대상). 본인
    --        조회라 requester_name도 i_user_id 자신의 user_name이다. password_hash는 '***'로
    --        마스킹한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    SELECT JSON_OBJECT(
        'user_id', `user_id`, 'company_id', `company_id`,
        'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
        'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
        'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
        'status', `status`, 'last_login_at', `last_login_at`,
        'created_at', `created_at`, 'updated_at', `updated_at`
    ) INTO v_before_json
    FROM `user` WHERE `user_id` = i_user_id;

    START TRANSACTION;

        UPDATE `user`
        SET `password_hash` = i_new_password_hash
        WHERE `user_id` = i_user_id;

        UPDATE `user_session`
        SET `status` = 0
        WHERE `user_id` = i_user_id AND `status` = 1;

    COMMIT;

    SELECT 0 AS RESULT;
    SELECT
        v_before_json AS before_json,
        JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) AS after_json,
        `user_name` AS requester_name
    FROM `user`
    WHERE `user_id` = i_user_id;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_PASSWORD_RESET
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_PASSWORD_RESET`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_PASSWORD_RESET` (
    IN i_user_id           BIGINT UNSIGNED,  -- 대상 사용자 ID
    IN i_new_password_hash VARCHAR(255),     -- 새 비밀번호 bcrypt 해시(앱 레이어에서 해시 완료)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '관리자 비밀번호 강제 초기화 - SUPER_ADMIN 재검증, 전체 활성 세션 종료 (12_USER_API.md 1.7)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_PASSWORD_RESET
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : SP_USER_PASSWORD_CHANGE(09_AUTH_API.md 9장, 본인 비밀번호 변경)와 로직은 거의
    --        동일하지만, 이쪽은 대상 user_id가 URL 파라미터로 임의 지정되므로(호출자 본인이
    --        아님) 존재 확인(31003)이 먼저 필요하다는 점이 다르다 - 그래서 SP를 공유하지 않고
    --        별도로 둔다. 현재 비밀번호 검증 없이 즉시 변경하며(12_USER_API.md 1.7 Description),
    --        password_hash 갱신과 "모든 활성 세션 종료"를 하나의 트랜잭션으로 묶는다.
    --        비밀번호 강제 초기화는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다
    --        (password_hash는 변경 전/후 모두 '***'로 마스킹 — 13_LOG_AUDIT_API.md 2.4).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user` WHERE `user_id` = i_user_id;

        START TRANSACTION;

            UPDATE `user`
            SET `password_hash` = i_new_password_hash
            WHERE `user_id` = i_user_id;

            UPDATE `user_session`
            SET `status` = 0
            WHERE `user_id` = i_user_id AND `status` = 1;

        COMMIT;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', `user_id`, 'company_id', `company_id`,
                'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
                'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
                'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
                'status', `status`, 'last_login_at', `last_login_at`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_REJECT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_REJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_REJECT` (
    IN i_user_id           BIGINT UNSIGNED,  -- 반려할 사용자 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '가입반려 - SUPER_ADMIN 재검증, status 0(대기) -> 2(반려) 조건부 UPDATE (12_USER_API.md 1.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_REJECT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : SP_USER_APPROVE와 동일한 조건부 UPDATE + 실패 사유 진단 패턴(31003 vs 30004),
    --        그리고 동일한 FN_IS_SUPER_ADMIN 재검증(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 SP_USER_APPROVE와 동일하게 UPDATE 직전
    --        v_before_json 캡처 + 결과 SELECT에 before_json/after_json/requester_name 추가
    --        (password_hash '***' 마스킹).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user` WHERE `user_id` = i_user_id;

        UPDATE `user`
        SET `status` = 2
        WHERE `user_id` = i_user_id AND `status` = 0;

        IF ROW_COUNT() = 0 THEN
            IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
                SELECT 31003 AS RESULT;
            ELSE
                SELECT 30004 AS RESULT;
            END IF;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', `user_id`, 'company_id', `company_id`,
                'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
                'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
                'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
                'status', `status`, 'last_login_at', `last_login_at`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_CREATE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 배정할 사용자 ID
    IN i_project_id        BIGINT UNSIGNED,  -- 배정할 프로젝트 ID
    IN i_role_code         TINYINT UNSIGNED, -- 권한 코드 (20/30/40 - 10은 앱 레이어 DTO 검증에서 이미 차단)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_role 배정 생성 - SUPER_ADMIN 재검증, 회사 일치 검증 + 중복 배정 차단 (12_USER_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user 존재(31003) -> project 존재(31002) -> user.company_id와 project.company_id
    --        일치 여부(다른 회사 소속 프로젝트에는 등록 불가, 12_USER_API.md 3.1 Validation) ->
    --        (user_id, project_id) 중복 배정(32001) 순으로 검증한다. 회사 불일치는 인가 실패가
    --        아니라 "이 project_id 값 자체가 이 요청에서는 허용되지 않는다"는 입력값 검증으로
    --        보아 30003(허용되지 않는 값)을 쓴다 - PERMISSION_DENIED(20001)는 호출자 본인의
    --        권한 부족에, 30003은 요청 바디 조합 자체의 유효성 문제에 쓴다는 구분을 유지한다.
    --        복합 PK(user_id, project_id) 유니크 위반(경쟁 상태 백스톱) - mysql_errno 1062.
    --        이 SP는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, FN_IS_SUPER_ADMIN으로
    --        가장 먼저 재확인한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 결과 SELECT에 after_json/requester_name과
    --        스코핑/표시명용 company_id(project 조인)/user_name/project_name을 추가했다
    --        (before_json은 CREATE라 NULL). user_role은 company_id 컬럼이 없어 project 테이블을
    --        조인해서 얻는다 - 이미 위 검증 단계에서 하던 조인 패턴 그대로다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM `user` u
            JOIN `project` p ON p.`company_id` = u.`company_id`
            WHERE u.`user_id` = i_user_id AND p.`project_id` = i_project_id
        ) THEN
            SELECT 30003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (
            SELECT 1 FROM `user_role`
            WHERE `user_id` = i_user_id AND `project_id` = i_project_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `user_role` (`user_id`, `project_id`, `role_code`)
        VALUES (i_user_id, i_project_id, i_role_code);

        SELECT 0 AS RESULT;
        SELECT
            ur.`user_id`, ur.`project_id`, ur.`role_code`, ur.`status`,
            ur.`created_at`, ur.`updated_at`,
            p.`company_id`, u.`user_name`, p.`project_name`,
            JSON_OBJECT(                    -- after_json: log_audit 스냅샷
                'user_id', ur.`user_id`, 'project_id', ur.`project_id`,
                'role_code', ur.`role_code`, 'status', ur.`status`,
                'created_at', ur.`created_at`, 'updated_at', ur.`updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user_role` ur
        JOIN `user` u ON u.`user_id` = ur.`user_id`
        JOIN `project` p ON p.`project_id` = ur.`project_id`
        WHERE ur.`user_id` = i_user_id AND ur.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_GET_BY_PROJECT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_GET_BY_PROJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_GET_BY_PROJECT` (
    IN i_user_id    BIGINT UNSIGNED,  -- 조회할 사용자 ID
    IN i_project_id BIGINT UNSIGNED   -- 조회할 프로젝트 ID
) COMMENT '특정 프로젝트에 대한 사용자의 실제 role_code 조회 (11_PROJECT_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_GET_BY_PROJECT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 헤더에서 선택된 project_id에 대한 호출자의 실제 role_code를 조회한다
    --        (11_PROJECT_API.md 3.1 — JWT의 role_code는 여러 프로젝트 중 최고 권한 하나뿐이라
    --        특정 project_id 기준 실제 권한은 이 SP로 별도 조회해야 함). 활성 배정(status=1)이
    --        없는 것은 오류가 아니라 정상적인 "미배정" 상태라 RESULT는 항상 0이고, 데이터가
    --        없으면 앱 레이어(UserRoleService)가 role_code:null로 매핑한다. SUPER_ADMIN은
    --        이 SP를 호출하지 않고 앱 레이어가 즉시 role_code:10을 반환한다(배정 여부 무관).
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
    SELECT `role_code`
    FROM `user_role`
    WHERE `user_id` = i_user_id AND `project_id` = i_project_id AND `status` = 1;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_LIST` (
    IN i_user_id           BIGINT UNSIGNED,  -- 사용자 ID 필터 (NULL이면 전체)
    IN i_project_id        BIGINT UNSIGNED,  -- 프로젝트 ID 필터 (NULL이면 전체)
    IN i_role_code         TINYINT UNSIGNED, -- 권한 코드 필터 (NULL이면 전체)
    IN i_status            TINYINT UNSIGNED, -- 상태 필터 (NULL이면 전체)
    IN i_limit             INT,              -- 페이지당 행 수
    IN i_offset            INT,              -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_role 목록 조회 - SUPER_ADMIN 재검증 (12_USER_API.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user_id/project_id/role_code/status 조건부 필터 + 페이지네이션. 다른 목록 SP와
    --        동일하게 별도 COUNT 서브쿼리 + LEFT JOIN ... ON TRUE로 total_count를 반환한다
    --        (COUNT(*) OVER()는 offset이 범위를 벗어나 0행이 반환되면 total_count도 0으로
    --        사라지는 버그가 있어 2026-07-19 이 패턴으로 교체). 정렬은
    --        12_USER_API.md 3.2 Sorting 그대로(status DESC, role_code ASC, user_id ASC).
    --        이 SP는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, FN_IS_SUPER_ADMIN으로
    --        재확인한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
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
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`user_id`, p.`project_id`, p.`role_code`, p.`status`, p.`created_at`, p.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `user_role`
            WHERE (i_user_id IS NULL OR `user_id` = i_user_id)
              AND (i_project_id IS NULL OR `project_id` = i_project_id)
              AND (i_role_code IS NULL OR `role_code` = i_role_code)
              AND (i_status IS NULL OR `status` = i_status)
        ) cnt
        LEFT JOIN (
            SELECT `user_id`, `project_id`, `role_code`, `status`, `created_at`, `updated_at`
            FROM `user_role`
            WHERE (i_user_id IS NULL OR `user_id` = i_user_id)
              AND (i_project_id IS NULL OR `project_id` = i_project_id)
              AND (i_role_code IS NULL OR `role_code` = i_role_code)
              AND (i_status IS NULL OR `status` = i_status)
            ORDER BY `status` DESC, `role_code` ASC, `user_id` ASC
            LIMIT i_limit OFFSET i_offset
        ) p ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_UPDATE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 복합 PK - 사용자 ID
    IN i_project_id        BIGINT UNSIGNED,  -- 복합 PK - 프로젝트 ID
    IN i_role_code         TINYINT UNSIGNED, -- 새 권한 코드 (NULL이면 미변경, 10은 불가)
    IN i_status            TINYINT UNSIGNED, -- 새 상태 (NULL이면 미변경)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_role 수정 - SUPER_ADMIN 재검증, 조건부 UPDATE, role_code=10 전환 차단 (12_USER_API.md 3.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user_id/project_id는 복합 PK라 이 SP에서 변경 대상이 아니다(Non-Updatable Fields,
    --        12_USER_API.md 3.3). role_code=10(SUPER_ADMIN)으로의 변경은 명시적으로 30003을
    --        반환한다(3.3 Business Rules) - DTO 레이어에서 20/30/40으로 막지 않고 여기서 막는
    --        이유는 문서가 이 케이스를 SP/서비스 레벨의 명시적 오류 코드로 지정했기 때문이다.
    --        물리 삭제 없음 원칙에 따라 권한 중지는 status=0 조건부 UPDATE로만 처리한다.
    --        이 SP는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, FN_IS_SUPER_ADMIN으로
    --        가장 먼저 재확인한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name과 스코핑/표시명용
    --        company_id(project 조인)/user_name/project_name을 추가했다(SP_USER_ROLE_CREATE와
    --        동일한 조인 패턴).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF i_role_code = 10 THEN
            SELECT 30003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM `user_role` WHERE `user_id` = i_user_id AND `project_id` = i_project_id
        ) THEN
            SELECT 31007 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷
            'user_id', `user_id`, 'project_id', `project_id`, 'role_code', `role_code`,
            'status', `status`, 'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user_role` WHERE `user_id` = i_user_id AND `project_id` = i_project_id;

        UPDATE `user_role`
        SET
            `role_code` = COALESCE(i_role_code, `role_code`),
            `status`    = COALESCE(i_status, `status`)
        WHERE `user_id` = i_user_id AND `project_id` = i_project_id;

        SELECT 0 AS RESULT;
        SELECT
            ur.`user_id`, ur.`project_id`, ur.`role_code`, ur.`status`,
            ur.`created_at`, ur.`updated_at`,
            p.`company_id`, u.`user_name`, p.`project_name`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', ur.`user_id`, 'project_id', ur.`project_id`,
                'role_code', ur.`role_code`, 'status', ur.`status`,
                'created_at', ur.`created_at`, 'updated_at', ur.`updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user_role` ur
        JOIN `user` u ON u.`user_id` = ur.`user_id`
        JOIN `project` p ON p.`project_id` = ur.`project_id`
        WHERE ur.`user_id` = i_user_id AND ur.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_CREATE` (
    IN i_user_id             BIGINT UNSIGNED,  -- 로그인한 사용자 ID
    IN i_access_token_jti    VARCHAR(100),      -- 발급한 Access Token의 JTI
    IN i_refresh_token_hash  VARCHAR(255),      -- Refresh Token(UUID v4) SHA-256 해시값
    IN i_expired_at          DATETIME          -- 세션 만료일시(JWT_REFRESH_EXPIRES_IN만큼 더한 절대시각)
) COMMENT '로그인 세션 생성 - last_login_at 갱신 + user_session INSERT (09_AUTH_API.md 5장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인 성공 시 user.last_login_at 갱신과 user_session INSERT를 하나의 트랜잭션으로 처리해
    --        원자성을 보장한다. role_code는 이미 SP_USER_GET_BY_LOGIN_ID에서 계산했으므로 여기서
    --        다시 계산하지 않는다(순수 세션 기록 전용).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_now         DATETIME     DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    SET v_now = NOW();

    START TRANSACTION;

        UPDATE `user`
        SET `last_login_at` = v_now
        WHERE `user_id` = i_user_id;

        INSERT INTO `user_session` (
            `user_id`, `access_token_jti`, `refresh_token_hash`, `expired_at`, `last_access_at`, `status`
        ) VALUES (
            i_user_id, i_access_token_jti, i_refresh_token_hash, i_expired_at, v_now, 1
        );

    COMMIT;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_GET_BY_REFRESH_HASH
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_GET_BY_REFRESH_HASH`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_GET_BY_REFRESH_HASH` (
    IN i_refresh_token_hash VARCHAR(255)  -- Refresh Token SHA-256 해시값
) COMMENT 'Refresh Token 해시로 활성 세션 조회, role_code 재계산 (09_AUTH_API.md 7장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_GET_BY_REFRESH_HASH
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : POST /auth/refresh 처리용 세션 조회. status=1이고 만료되지 않은 세션만 대상으로 하며,
    --        세션이 없거나 만료된 경우를 구분하지 않고 10008(Refresh Token 만료)로 통일한다.
    --        role_code는 SP_USER_GET_BY_LOGIN_ID와 동일하게 이 시점에 다시 계산한다(저장값을
    --        그대로 반환하지 않음 — 09_AUTH_API.md 7장 참고).
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
        IF NOT EXISTS (
            SELECT 1 FROM `user_session`
            WHERE `refresh_token_hash` = i_refresh_token_hash AND `status` = 1 AND `expired_at` > NOW()
        ) THEN
            SELECT 10008 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            s.`session_id`, s.`user_id`, u.`status` AS user_status, u.`company_id`,
            COALESCE(MIN(ur.`role_code`), 40) AS role_code
        FROM `user_session` s
        JOIN `user` u ON s.`user_id` = u.`user_id`
        LEFT JOIN `user_role` ur ON u.`user_id` = ur.`user_id` AND ur.`status` = 1
        WHERE s.`refresh_token_hash` = i_refresh_token_hash AND s.`status` = 1 AND s.`expired_at` > NOW()
        GROUP BY s.`session_id`, s.`user_id`, u.`status`, u.`company_id`;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_LOGOUT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_LOGOUT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_LOGOUT` (
    IN i_access_token_jti VARCHAR(100)  -- 로그아웃할 현재 Access Token의 JTI
) COMMENT '현재 세션 로그아웃 - status=0 (09_AUTH_API.md 6장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_LOGOUT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : JwtAuthGuard가 이미 유효성을 확인한 access_token_jti 기준으로 현재 세션만 종료한다.
    --        조건부 UPDATE(status=1인 행만 대상)라 이미 로그아웃된 세션에 다시 호출해도 안전하다
    --        (영향받은 행이 0건이어도 에러가 아니라 정상 종료 취급 — 멱등하게 동작).
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

    UPDATE `user_session`
    SET `status` = 0
    WHERE `access_token_jti` = i_access_token_jti AND `status` = 1;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_UPDATE_JTI
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_UPDATE_JTI`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_UPDATE_JTI` (
    IN i_session_id       BIGINT UNSIGNED,  -- 세션 ID
    IN i_access_token_jti VARCHAR(100)       -- 새로 발급한 Access Token JTI
) COMMENT 'Access Token 재발급 시 세션의 JTI/last_access_at 갱신 (09_AUTH_API.md 7장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_UPDATE_JTI
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : POST /auth/refresh 처리 후 세션의 access_token_jti를 새 값으로 갱신한다.
    --        refresh_token은 재발급하지 않으므로(최초 로그인 시 1회만 저장) 여기서 건드리지 않는다.
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

    UPDATE `user_session`
    SET `access_token_jti` = i_access_token_jti,
        `last_access_at` = NOW()
    WHERE `session_id` = i_session_id;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_VALIDATE_BY_JTI
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_VALIDATE_BY_JTI`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_VALIDATE_BY_JTI` (
    IN i_access_token_jti VARCHAR(100)  -- 검증할 Access Token의 JTI
) COMMENT 'JwtAuthGuard 전용 - 세션/사용자 상태 검증 (07_AUTH_SECURITY.md 1.5 3~4번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_VALIDATE_BY_JTI
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 보호된 API 요청마다 JwtAuthGuard가 호출하는 세션/사용자 상태 검증
    --        (07_AUTH_SECURITY.md 1.5 "3. Session 확인 / 4. User 상태 확인").
    --        role_code는 여기서 다시 조회하지 않는다 — Access Token(JWT) 자체가 이미 서명으로
    --        보증된 role_code를 담고 있어, 매 요청마다 user_role을 다시 조인하는 건 불필요한 비용이다
    --        (role_code는 로그인/재발급 시점에만 재계산, 09_AUTH_API.md 7장 참고).
    --        세션이 없거나 로그아웃(status!=1)되었거나 만료(expired_at<=NOW())된 경우
    --        10009(유효하지 않은 Session)를 반환한다 — expired_at 체크가 없으면 세션 만료 이후에도
    --        그 직전에 발급된 Access Token이 자기 수명(15분)이 남아있는 동안 계속 통과해버리는
    --        구멍이 생긴다(2026-07-19 리뷰에서 발견, SP_USER_SESSION_GET_BY_REFRESH_HASH와
    --        동일하게 맞춤).
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
        IF NOT EXISTS (
            SELECT 1 FROM `user_session`
            WHERE `access_token_jti` = i_access_token_jti AND `status` = 1 AND `expired_at` > NOW()
        ) THEN
            SELECT 10009 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT u.`user_id`, u.`company_id`, u.`status` AS user_status
        FROM `user_session` s
        JOIN `user` u ON s.`user_id` = u.`user_id`
        WHERE s.`access_token_jti` = i_access_token_jti AND s.`status` = 1 AND s.`expired_at` > NOW();
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SIGNUP
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SIGNUP`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SIGNUP` (
    IN i_company_id            BIGINT UNSIGNED,  -- 가입 신청 회사 ID
    IN i_requested_project_id  BIGINT UNSIGNED,  -- 가입 신청 프로젝트 ID (영구 보관, 이후 변경 불가)
    IN i_login_id              VARCHAR(100),      -- 로그인 ID
    IN i_password_hash         VARCHAR(255),      -- bcrypt 해시(앱 레이어에서 해시 완료 후 전달)
    IN i_user_name             VARCHAR(100),      -- 사용자명
    IN i_email                 VARCHAR(200),      -- 이메일
    IN i_phone_number_enc      VARCHAR(255),      -- 휴대폰번호 AES-256-CBC 암호화값(앱 레이어에서 암호화 완료 후 전달)
    IN i_department            VARCHAR(100),      -- 부서 (선택)
    IN i_position              VARCHAR(100)       -- 직급 (선택)
) COMMENT '회원가입 - status=0(가입승인대기)으로 user INSERT (09_AUTH_API.md 4장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SIGNUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회원가입 처리. company_id/requested_project_id 존재 및 소속 관계를 검증하고,
    --        login_id/email 중복을 확인한 뒤 status=0(가입승인대기)으로 user를 생성한다.
    --        password_hash/phone_number 암호화는 이미 앱 레이어(bcrypt/CryptoService)에서 끝난 값을
    --        그대로 저장한다 — SP는 암호화 로직을 모른다.
    --        아래 IF EXISTS 사전 체크는 일반적인 경우엔 빠르고 명확하지만 원자적이지 않다 — 동시에
    --        같은 login_id/email로 두 요청이 들어오면 둘 다 통과해버릴 수 있다. 그 드문 경쟁 상황을
    --        대비해 INSERT의 UNIQUE 제약 위반(1062) 전용 핸들러를 추가로 둬서, 사전 체크를 통과한
    --        뒤에도 실제 INSERT에서 걸리면 50001이 아니라 32001로 정확히 응답되게 한다
    --        (2026-07-19 리뷰에서 발견 — SP_NONCE_INSERT와 같은 원리).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_user_id     BIGINT       DEFAULT NULL;

    -- login_id/email 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM `project`
            WHERE `project_id` = i_requested_project_id AND `company_id` = i_company_id
        ) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (SELECT 1 FROM `user` WHERE `login_id` = i_login_id OR `email` = i_email) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `user` (
            `company_id`, `requested_project_id`, `login_id`, `password_hash`,
            `user_name`, `email`, `phone_number`, `department`, `position`, `status`
        ) VALUES (
            i_company_id, i_requested_project_id, i_login_id, i_password_hash,
            i_user_name, i_email, i_phone_number_enc, i_department, i_position, 0
        );

        SET v_user_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`,
            `email`, `phone_number`, `department`, `position`, `status`,
            `last_login_at`, `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = v_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_UPDATE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 수정할 사용자 ID
    IN i_user_name         VARCHAR(100),     -- 새 사용자명 (NULL이면 미변경)
    IN i_email             VARCHAR(200),     -- 새 이메일 (NULL이면 미변경)
    IN i_phone_number_enc  VARCHAR(255),     -- 새 휴대폰번호 AES-256-CBC 암호화값 (NULL이면 미변경)
    IN i_department        VARCHAR(100),     -- 새 부서 (NULL이면 미변경)
    IN i_position          VARCHAR(100),     -- 새 직급 (NULL이면 미변경)
    IN i_status            TINYINT UNSIGNED, -- 새 상태 (NULL이면 미변경)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '사용자 정보 수정 - SUPER_ADMIN 재검증, 조건부 UPDATE + status=3 전환 시 전체 세션 종료 (12_USER_API.md 1.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id/requested_project_id/login_id는 이 SP의 파라미터에 아예 없다 - 수정 불가
    --        필드라 애초에 받지 않는다(12_USER_API.md 1.6 Non-Updatable Fields). 존재 확인(31003)
    --        -> email 변경 시 중복 확인(자기 자신 제외, 32001) -> COALESCE 기반 조건부 UPDATE
    --        (02_DEV_CONVENTIONS.md 4장). email 유니크 제약 위반(1062) 백스톱도 CREATE/UPDATE류
    --        SP와 동일한 이유로 둔다.
    --        i_status=3(사용중지)으로 전환하는 경우에만 해당 사용자의 활성 세션을 전부 종료한다
    --        (12_USER_API.md 1.6 Business Rules, 07_AUTH_SECURITY.md 1.3) - 이미 3이었거나 다른
    --        값으로 바뀌는 경우는 세션에 영향을 주지 않는다. UPDATE 규약(3.4)은 status 값 전이
    --        자체를 검증하지 않는다고 명시하므로(화면 버튼 기준일 뿐) 여기서도 임의의 status 값
    --        전달을 그대로 허용한다.
    --        사용자 수정은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다
    --        (password_hash '***' 마스킹).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    -- email 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF i_email IS NOT NULL AND EXISTS (
            SELECT 1 FROM `user` WHERE `email` = i_email AND `user_id` <> i_user_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user` WHERE `user_id` = i_user_id;

        START TRANSACTION;

            UPDATE `user`
            SET
                `user_name`    = COALESCE(i_user_name, `user_name`),
                `email`        = COALESCE(i_email, `email`),
                `phone_number` = COALESCE(i_phone_number_enc, `phone_number`),
                `department`   = COALESCE(i_department, `department`),
                `position`     = COALESCE(i_position, `position`),
                `status`       = COALESCE(i_status, `status`)
            WHERE `user_id` = i_user_id;

            IF i_status = 3 THEN
                UPDATE `user_session`
                SET `status` = 0
                WHERE `user_id` = i_user_id AND `status` = 1;
            END IF;

        COMMIT;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', `user_id`, 'company_id', `company_id`,
                'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
                'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
                'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
                'status', `status`, 'last_login_at', `last_login_at`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;
