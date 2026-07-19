DROP PROCEDURE IF EXISTS `SP_COMPANY_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_LIST` (
    IN i_status    TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_page_size INT,               -- 페이지당 행 수
    IN i_offset    INT                -- 시작 오프셋
) COMMENT '회사 목록 조회 - 페이지네이션 (10_COMPANY_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 목록을 status DESC, company_name ASC로 정렬해 페이지 단위로 반환한다.
    --        02_DEV_CONVENTIONS.md 3.4의 RESULT SELECT 규약은 RESULT + data 정확히 2개 result set만
    --        허용하므로, 별도의 COUNT(*) 쿼리를 셋째 result set으로 추가하는 대신 COUNT(*) OVER()
    --        윈도우 함수로 총 개수를 data의 각 행에 함께 실어보낸다 — 페이지네이션이 필요한 다른
    --        목록 SP(project/user 등)도 이 패턴을 그대로 재사용한다.
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
        `company_id`, `company_code`, `company_name`, `description`,
        `status`, `created_at`, `updated_at`,
        COUNT(*) OVER() AS total_count
    FROM `company`
    WHERE i_status IS NULL OR `status` = i_status
    ORDER BY `status` DESC, `company_name` ASC
    LIMIT i_page_size OFFSET i_offset;
END$$

DELIMITER ;
