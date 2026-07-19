DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_ID` (
    IN i_project_id BIGINT UNSIGNED  -- 조회할 프로젝트 ID
) COMMENT '프로젝트 상세 조회 - company 조인 (11_PROJECT_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : project_id로 프로젝트 상세를 조회한다. company_code/company_name을 함께 반환하기
    --        위해 company를 조인한다. 없으면 31002. DEVELOPER의 타사 프로젝트 접근 차단(20001)은
    --        여기서 판단하지 않는다 — 앱 레이어(ProjectService)가 조회 결과의 company_id를
    --        요청자의 companyId와 비교해 판단한다(이 SP는 SUPER_ADMIN/DEVELOPER 구분을 모른다).
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
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
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
