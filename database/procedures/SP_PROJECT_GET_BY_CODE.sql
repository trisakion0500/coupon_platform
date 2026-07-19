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
