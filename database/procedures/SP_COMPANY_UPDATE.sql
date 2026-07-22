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
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다.
    --        2026-07-22: before_json 캡처가 락 없는 별도 SELECT로 UPDATE보다 먼저 실행돼, 그 사이
    --        다른 트랜잭션이 같은 행을 커밋하면 캡처된 before_json이 실제 직전 상태가 아닌 더
    --        오래된 상태를 가리키는 문제를 전수감사에서 발견 - 캡처를 `SELECT ... FOR UPDATE`로
    --        바꾸고 UPDATE와 같은 명시적 트랜잭션으로 묶어, 캡처 시점에 이미 해당 행을 잠가
    --        UPDATE까지 원자적으로 처리한다(캡처와 UPDATE 사이 레이스 윈도우 자체를 제거).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    -- company_code 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        ROLLBACK;
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

        START TRANSACTION;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷(log_audit용), FOR UPDATE로 잠금
            'company_id', `company_id`, 'company_code', `company_code`,
            'company_name', `company_name`, 'description', `description`,
            'status', `status`, 'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `company` WHERE `company_id` = i_company_id
        FOR UPDATE;

        UPDATE `company`
        SET
            `company_code` = COALESCE(i_company_code, `company_code`),
            `company_name` = COALESCE(i_company_name, `company_name`),
            `description`  = COALESCE(i_description, `description`),
            `status`       = COALESCE(i_status, `status`)
        WHERE `company_id` = i_company_id;

        COMMIT;

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
