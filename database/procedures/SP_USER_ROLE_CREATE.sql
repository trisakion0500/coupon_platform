DROP PROCEDURE IF EXISTS `SP_USER_ROLE_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_CREATE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 배정할 사용자 ID
    IN i_project_id        BIGINT UNSIGNED,  -- 배정할 프로젝트 ID
    IN i_role_code         TINYINT UNSIGNED, -- 권한 코드 (20/30/40 - 10은 앱 레이어 DTO 검증에서 이미 차단)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_role 배정 생성 - SUPER_ADMIN 재검증, 회사 일치 검증 + 중복 배정 차단 (12_USER_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user 존재(31003) -> project 존재(31002) -> user.company_id와 project.company_id
    --        일치 여부(다른 회사 소속 프로젝트에는 등록 불가, 12_USER_API.md 3.1 Validation) ->
    --        (user_id, project_id) 중복 배정(32001) 순으로 검증한다. 회사 불일치는 인가 실패가
    --        아니라 "이 project_id 값 자체가 이 요청에서는 허용되지 않는다"는 입력값 검증으로
    --        보아 30003(허용되지 않는 값)을 쓴다 - PERMISSION_DENIED(20001)는 호출자 본인의
    --        권한 부족에, 30003은 요청 바디 조합 자체의 유효성 문제에 쓴다는 구분을 유지한다.
    --        복합 PK(user_id, project_id) 유니크 위반(경쟁 상태 백스톱) - mysql_errno 1062.
    --        이 SP는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, FN_IS_SUPER_ADMIN으로
    --        가장 먼저 재확인한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

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
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM `user` u
            JOIN `project` p ON p.`company_id` = u.`company_id`
            WHERE u.`user_id` = i_user_id AND p.`project_id` = i_project_id
        ) THEN
            SELECT 30003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (
            SELECT 1 FROM `user_role`
            WHERE `user_id` = i_user_id AND `project_id` = i_project_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `user_role` (`user_id`, `project_id`, `role_code`)
        VALUES (i_user_id, i_project_id, i_role_code);

        SELECT 0 AS RESULT;
        SELECT `user_id`, `project_id`, `role_code`, `status`, `created_at`, `updated_at`
        FROM `user_role`
        WHERE `user_id` = i_user_id AND `project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;
