DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_ACTIVE_HEADER_DATA`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_ACTIVE_HEADER_DATA` (
    IN i_user_id    BIGINT UNSIGNED,  -- 요청자 user_id (JWT 페이로드 값 그대로 신뢰)
    IN i_role_code  TINYINT UNSIGNED, -- 요청자 role_code (JWT 페이로드 값 그대로 신뢰)
    IN i_company_id BIGINT UNSIGNED   -- 요청자 소속 company_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '헤더 콤보박스용 활성 회사/프로젝트 조회 (12_COMPANY_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_ACTIVE_HEADER_DATA
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인 직후 헤더 콤보박스가 1회 로드하는 활성 회사·프로젝트 목록.
    --        role_code=10(SUPER_ADMIN)이면 전체 활성 회사+프로젝트, 그 외에는 본인 소속 회사 1건과
    --        user_role에 활성 배정(status=1)된 프로젝트만 반환한다 — 같은 회사 소속이어도 role
    --        미배정 프로젝트는 제외한다(12_COMPANY_API.md 3.1 Business Rules).
    --        role_code/company_id는 JwtAuthGuard가 검증한 JWT 페이로드 값을 그대로 신뢰하고 DB를
    --        재조회하지 않는다(jwt-auth.guard.ts와 같은 원칙, 로그인/재발급 시점에만 재계산됨).
    --        04_DEV_CONVENTIONS.md 3.4의 RESULT SELECT 규약은 RESULT + data 정확히 2개 result set만
    --        허용하므로, company/project를 각각 별도 result set으로 반환하는 대신 row_type
    --        판별 컬럼('COMPANY'/'PROJECT')으로 하나의 result set에 함께 담는다 — 서비스 레이어
    --        (company.service.ts)에서 row_type으로 다시 분리해 {companies, projects} 형태로 조립한다.
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

    IF i_role_code = 10 THEN
        SELECT 'COMPANY' AS row_type, `company_id` AS id, `company_id` AS company_id, `company_name` AS name
        FROM `company`
        WHERE `status` = 1
        UNION ALL
        SELECT 'PROJECT' AS row_type, `project_id` AS id, `company_id` AS company_id, `project_name` AS name
        FROM `project`
        WHERE `status` = 1;
    ELSE
        SELECT 'COMPANY' AS row_type, `company_id` AS id, `company_id` AS company_id, `company_name` AS name
        FROM `company`
        WHERE `company_id` = i_company_id AND `status` = 1
        UNION ALL
        SELECT 'PROJECT' AS row_type, p.`project_id` AS id, p.`company_id` AS company_id, p.`project_name` AS name
        FROM `project` p
        INNER JOIN `user_role` ur ON ur.`project_id` = p.`project_id`
        WHERE ur.`user_id` = i_user_id AND ur.`status` = 1 AND p.`status` = 1;
    END IF;
END$$

DELIMITER ;
