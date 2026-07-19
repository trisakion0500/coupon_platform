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
