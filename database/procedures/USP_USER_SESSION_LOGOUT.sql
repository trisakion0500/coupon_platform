DROP PROCEDURE IF EXISTS `USP_USER_SESSION_LOGOUT`;

DELIMITER $$

CREATE PROCEDURE `USP_USER_SESSION_LOGOUT` (
    IN i_access_token_jti VARCHAR(100)  -- 로그아웃할 현재 Access Token의 JTI
)
COMMENT '현재 세션 로그아웃 - status=0 (09_AUTH_API.md 6장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : USP_USER_SESSION_LOGOUT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : JwtAuthGuard가 이미 유효성을 확인한 access_token_jti 기준으로 현재 세션만 종료한다.
    --        조건부 UPDATE(status=1인 행만 대상)라 이미 로그아웃된 세션에 다시 호출해도 안전하다
    --        (영향받은 행이 0건이어도 에러가 아니라 정상 종료 취급 — 멱등하게 동작).
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
    SET `status` = 0
    WHERE `access_token_jti` = i_access_token_jti AND `status` = 1;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
