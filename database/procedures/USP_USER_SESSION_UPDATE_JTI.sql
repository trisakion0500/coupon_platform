DROP PROCEDURE IF EXISTS `USP_USER_SESSION_UPDATE_JTI`;

DELIMITER $$

CREATE PROCEDURE `USP_USER_SESSION_UPDATE_JTI` (
    IN i_session_id       BIGINT UNSIGNED,  -- 세션 ID
    IN i_access_token_jti VARCHAR(100)       -- 새로 발급한 Access Token JTI
)
COMMENT 'Access Token 재발급 시 세션의 JTI/last_access_at 갱신 (09_AUTH_API.md 7장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : USP_USER_SESSION_UPDATE_JTI
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : POST /auth/refresh 처리 후 세션의 access_token_jti를 새 값으로 갱신한다.
    --        refresh_token은 재발급하지 않으므로(최초 로그인 시 1회만 저장) 여기서 건드리지 않는다.
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

    UPDATE `user_session`
    SET `access_token_jti` = i_access_token_jti,
        `last_access_at` = NOW()
    WHERE `session_id` = i_session_id;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
