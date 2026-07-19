DROP PROCEDURE IF EXISTS `SP_USER_ROLE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_LIST` (
    IN i_user_id           BIGINT UNSIGNED,  -- 사용자 ID 필터 (NULL이면 전체)
    IN i_project_id        BIGINT UNSIGNED,  -- 프로젝트 ID 필터 (NULL이면 전체)
    IN i_role_code         TINYINT UNSIGNED, -- 권한 코드 필터 (NULL이면 전체)
    IN i_status            TINYINT UNSIGNED, -- 상태 필터 (NULL이면 전체)
    IN i_limit             INT,              -- 페이지당 행 수
    IN i_offset            INT,              -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_role 목록 조회 - SUPER_ADMIN 재검증 (12_USER_API.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user_id/project_id/role_code/status 조건부 필터 + 페이지네이션. 다른 목록 SP와
    --        동일하게 COUNT(*) OVER()로 total_count를 각 행에 실어 반환한다. 정렬은
    --        12_USER_API.md 3.2 Sorting 그대로(status DESC, role_code ASC, user_id ASC).
    --        이 SP는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, FN_IS_SUPER_ADMIN으로
    --        재확인한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
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
            `user_id`, `project_id`, `role_code`, `status`, `created_at`, `updated_at`,
            COUNT(*) OVER() AS total_count
        FROM `user_role`
        WHERE (i_user_id IS NULL OR `user_id` = i_user_id)
          AND (i_project_id IS NULL OR `project_id` = i_project_id)
          AND (i_role_code IS NULL OR `role_code` = i_role_code)
          AND (i_status IS NULL OR `status` = i_status)
        ORDER BY `status` DESC, `role_code` ASC, `user_id` ASC
        LIMIT i_limit OFFSET i_offset;
    END proc_block;
END$$

DELIMITER ;
