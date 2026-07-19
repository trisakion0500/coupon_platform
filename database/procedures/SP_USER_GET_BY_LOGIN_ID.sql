DROP PROCEDURE IF EXISTS `SP_USER_GET_BY_LOGIN_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_GET_BY_LOGIN_ID` (
    IN i_login_id VARCHAR(100)  -- 로그인 ID
) COMMENT '로그인 처리 전용 - login_id로 user 조회, role_code(MIN, 미배정시 40)까지 함께 계산'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_GET_BY_LOGIN_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인(POST /auth/login) 처리용 사용자 조회. password_hash를 포함해 반환하므로
    --        앱 레이어가 bcrypt로 비교한다(SP는 비밀번호 검증 로직을 모른다).
    --        role_code는 user_session에 저장하지 않고 이 시점에 user_role을 조인해 계산한다
    --        (09_AUTH_API.md 7장 — 로그인/재발급 시점마다 동일한 방식으로 매번 재계산).
    --        login_id 자체가 없으면 10001(로그인 실패) — 비밀번호 불일치(10002)와는 앱 레이어에서 구분.
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
        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `login_id` = i_login_id) THEN
            SELECT 10001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            u.`user_id`, u.`company_id`, u.`requested_project_id`, u.`login_id`,
            u.`password_hash`, u.`user_name`, u.`email`, u.`phone_number`,
            u.`department`, u.`position`, u.`status`,
            COALESCE(MIN(ur.`role_code`), 40) AS role_code,
            u.`last_login_at`, u.`created_at`, u.`updated_at`
        FROM `user` u
        LEFT JOIN `user_role` ur ON u.`user_id` = ur.`user_id` AND ur.`status` = 1
        WHERE u.`login_id` = i_login_id
        GROUP BY
            u.`user_id`, u.`company_id`, u.`requested_project_id`, u.`login_id`,
            u.`password_hash`, u.`user_name`, u.`email`, u.`phone_number`,
            u.`department`, u.`position`, u.`status`,
            u.`last_login_at`, u.`created_at`, u.`updated_at`;
    END proc_block;
END$$

DELIMITER ;
