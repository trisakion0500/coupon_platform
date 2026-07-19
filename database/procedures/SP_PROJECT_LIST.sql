DROP PROCEDURE IF EXISTS `SP_PROJECT_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_LIST` (
    IN i_company_id BIGINT UNSIGNED,   -- 회사 필터 (NULL이면 전체 — DEVELOPER 호출 시 앱 레이어가 자기 회사로 강제)
    IN i_status     TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_page_size  INT,               -- 페이지당 행 수
    IN i_offset     INT                -- 시작 오프셋
) COMMENT '프로젝트 목록 조회 - 페이지네이션, company 조인 (11_PROJECT_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 목록을 status DESC, project_name ASC로 정렬해 페이지 단위로 반환한다.
    --        company_code/company_name을 함께 보여줘야 해서 company를 조인한다. DEVELOPER는
    --        본인 소속 company_id만 봐야 하는데(11_PROJECT_API.md 2.2 Business Rules), 그 스코핑은
    --        앱 레이어(ProjectService)가 i_company_id에 항상 자기 companyId를 채워 호출하는
    --        방식으로 강제한다 — SP는 SUPER_ADMIN/DEVELOPER 구분을 모르고 그냥 필터만 적용한다.
    --        total_count는 SP_COMPANY_LIST와 동일하게 COUNT(*) OVER()로 함께 반환한다.
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
    SELECT
        p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
        p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
        p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`,
        COUNT(*) OVER() AS total_count
    FROM `project` p
    JOIN `company` c ON c.`company_id` = p.`company_id`
    WHERE (i_company_id IS NULL OR p.`company_id` = i_company_id)
      AND (i_status IS NULL OR p.`status` = i_status)
    ORDER BY p.`status` DESC, p.`project_name` ASC
    LIMIT i_page_size OFFSET i_offset;
END$$

DELIMITER ;
