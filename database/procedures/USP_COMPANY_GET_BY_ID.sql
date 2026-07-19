DROP PROCEDURE IF EXISTS `USP_COMPANY_GET_BY_ID`;

DELIMITER $$

CREATE PROCEDURE `USP_COMPANY_GET_BY_ID` (
    IN i_company_id BIGINT UNSIGNED  -- 조회할 회사 ID
)
COMMENT '회사 상세 조회 (10_COMPANY_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : USP_COMPANY_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id로 회사 상세를 조회한다. 없으면 31001.
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
