DROP PROCEDURE IF EXISTS `SP_COMPANY_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_LIST` (
    IN i_status            TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_page_size         INT,               -- 페이지당 행 수
    IN i_offset            INT,               -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED    -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '회사 목록 조회 - SUPER_ADMIN 재검증, 페이지네이션 (12_COMPANY_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 목록을 status DESC, company_name ASC로 정렬해 페이지 단위로 반환한다.
    --        04_DEV_CONVENTIONS.md 3.4의 RESULT SELECT 규약은 RESULT + data 정확히 2개 result set만
    --        허용하므로, 별도의 COUNT(*) 쿼리를 셋째 result set으로 추가할 수 없다. 다만 total_count를
    --        페이지네이션 대상 SELECT에 COUNT(*) OVER()로 얹으면, 요청한 offset이 실제 데이터
    --        범위를 벗어나 0행이 반환되는 경우 total_count도 함께 사라져 0으로 잘못 응답되는
    --        문제가 있다(2026-07-19 감사에서 발견). 이를 막기 위해 총 개수를 별도 서브쿼리로 항상
    --        1행 계산해두고, 페이지네이션 서브쿼리를 LEFT JOIN ... ON TRUE로 붙인다 — 페이지네이션
    --        결과가 0행이어도 총 개수 행은 NULL 데이터 컬럼과 함께 보존된다(앱 레이어는 PK 컬럼이
    --        NULL인 행을 데이터 없음으로 취급하고 total_count만 읽는다). 페이지네이션이 필요한 다른
    --        목록 SP(project/user 등)도 이 패턴을 그대로 재사용한다.
    --        회사 관리메뉴는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 재확인한다(방어적 이중 체크, 04_DEV_CONVENTIONS.md 3.2).
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

        SELECT 0 AS RESULT;
        SELECT
            p.`company_id`, p.`company_code`, p.`company_name`, p.`description`,
            p.`status`, p.`created_at`, p.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `company`
            WHERE i_status IS NULL OR `status` = i_status
        ) cnt
        LEFT JOIN (
            SELECT `company_id`, `company_code`, `company_name`, `description`, `status`, `created_at`, `updated_at`
            FROM `company`
            WHERE i_status IS NULL OR `status` = i_status
            ORDER BY `status` DESC, `company_name` ASC
            LIMIT i_page_size OFFSET i_offset
        ) p ON TRUE;
    END proc_block;
END$$

DELIMITER ;
