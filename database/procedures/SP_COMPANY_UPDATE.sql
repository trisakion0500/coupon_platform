DROP PROCEDURE IF EXISTS `SP_COMPANY_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_UPDATE` (
    IN i_company_id   BIGINT UNSIGNED,  -- 수정할 회사 ID
    IN i_company_code VARCHAR(20),      -- 새 회사 코드 (NULL이면 미변경)
    IN i_company_name VARCHAR(100),     -- 새 회사명 (NULL이면 미변경)
    IN i_description  VARCHAR(1000),    -- 새 설명 (NULL이면 미변경)
    IN i_status       TINYINT UNSIGNED  -- 새 상태 (NULL이면 미변경)
) COMMENT '회사 수정 - 조건부 UPDATE (10_COMPANY_API.md 2.4)'
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
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

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
            `status`, `created_at`, `updated_at`
        FROM `company`
        WHERE `company_id` = i_company_id;
    END proc_block;
END$$

DELIMITER ;
