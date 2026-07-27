DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_BY_ID` (
    IN i_company_id        BIGINT UNSIGNED,  -- 조회할 회사 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '회사 상세 조회 - SUPER_ADMIN 재검증 (12_COMPANY_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id로 회사 상세를 조회한다. 없으면 31001. 회사 관리메뉴는 SUPER_ADMIN
    --        전용이라 RolesGuard가 이미 막고 있지만, 이 SP도 FN_IS_SUPER_ADMIN으로 재확인한다
    --        (방어적 이중 체크, 04_DEV_CONVENTIONS.md 3.2).
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
