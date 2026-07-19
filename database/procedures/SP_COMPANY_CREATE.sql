DROP PROCEDURE IF EXISTS `SP_COMPANY_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_CREATE` (
    IN i_company_code VARCHAR(20),   -- 회사 코드 (전역 UNIQUE)
    IN i_company_name VARCHAR(100),  -- 회사명
    IN i_description  VARCHAR(1000)  -- 설명 (선택)
) COMMENT '회사 생성 - company_code 중복 확인 후 INSERT (10_COMPANY_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 생성. company_code 중복을 사전 체크(32001)한 뒤 INSERT한다. SP_USER_SIGNUP과
    --        동일한 이유로 사전 체크는 원자적이지 않으므로(동시에 같은 code로 두 요청이 들어오면
    --        둘 다 통과할 수 있음), INSERT의 UNIQUE 제약 위반(1062) 전용 핸들러를 백스톱으로 둔다.
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
            `status`, `created_at`, `updated_at`
        FROM `company`
        WHERE `company_id` = v_company_id;
    END proc_block;
END$$

DELIMITER ;
