DROP PROCEDURE IF EXISTS `SP_USER_SESSION_GET_BY_REFRESH_HASH`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_GET_BY_REFRESH_HASH` (
    IN i_refresh_token_hash VARCHAR(255)  -- Refresh Token SHA-256 해시값
) COMMENT 'Refresh Token 해시로 활성 세션 조회, role_code 재계산 (11_AUTH_API.md 7장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_GET_BY_REFRESH_HASH
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : POST /auth/refresh 처리용 세션 조회. status=1이고 만료되지 않은 세션만 대상으로 하며,
    --        세션이 없거나 만료된 경우를 구분하지 않고 10008(Refresh Token 만료)로 통일한다.
    --        role_code는 SP_USER_GET_BY_LOGIN_ID와 동일하게 이 시점에 다시 계산한다(저장값을
    --        그대로 반환하지 않음 — 11_AUTH_API.md 7장 참고).
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
            SELECT 1 FROM `user_session`
            WHERE `refresh_token_hash` = i_refresh_token_hash AND `status` = 1 AND `expired_at` > NOW()
        ) THEN
            SELECT 10008 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            s.`session_id`, s.`user_id`, u.`status` AS user_status, u.`company_id`,
            COALESCE(MIN(ur.`role_code`), 40) AS role_code
        FROM `user_session` s
        JOIN `user` u ON s.`user_id` = u.`user_id`
        LEFT JOIN `user_role` ur ON u.`user_id` = ur.`user_id` AND ur.`status` = 1
        WHERE s.`refresh_token_hash` = i_refresh_token_hash AND s.`status` = 1 AND s.`expired_at` > NOW()
        GROUP BY s.`session_id`, s.`user_id`, u.`status`, u.`company_id`;
    END proc_block;
END$$

DELIMITER ;
