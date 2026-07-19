DROP PROCEDURE IF EXISTS `USP_USER_SESSION_CREATE`;

DELIMITER $$

CREATE PROCEDURE `USP_USER_SESSION_CREATE` (
    IN i_user_id             BIGINT UNSIGNED,  -- 로그인한 사용자 ID
    IN i_access_token_jti    VARCHAR(100),      -- 발급한 Access Token의 JTI
    IN i_refresh_token_hash  VARCHAR(255),      -- Refresh Token(UUID v4) SHA-256 해시값
    IN i_expired_at          DATETIME          -- 세션 만료일시(JWT_REFRESH_EXPIRES_IN만큼 더한 절대시각)
)
COMMENT '로그인 세션 생성 - last_login_at 갱신 + user_session INSERT (09_AUTH_API.md 5장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : USP_USER_SESSION_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인 성공 시 user.last_login_at 갱신과 user_session INSERT를 하나의 트랜잭션으로 처리해
    --        원자성을 보장한다. role_code는 이미 USP_USER_GET_BY_LOGIN_ID에서 계산했으므로 여기서
    --        다시 계산하지 않는다(순수 세션 기록 전용).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_now         DATETIME     DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    SET v_now = NOW();

    START TRANSACTION;

        UPDATE `user`
        SET `last_login_at` = v_now
        WHERE `user_id` = i_user_id;

        INSERT INTO `user_session` (
            `user_id`, `access_token_jti`, `refresh_token_hash`, `expired_at`, `last_access_at`, `status`
        ) VALUES (
            i_user_id, i_access_token_jti, i_refresh_token_hash, i_expired_at, v_now, 1
        );

    COMMIT;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
