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
            p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`, p.`edit_count`
        FROM `project` p
        JOIN `company` c ON c.`company_id` = p.`company_id`
        WHERE p.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;
