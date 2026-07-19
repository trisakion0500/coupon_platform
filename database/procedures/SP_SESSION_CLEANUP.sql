DROP PROCEDURE IF EXISTS `SP_SESSION_CLEANUP`;
DELIMITER $$
CREATE PROCEDURE `SP_SESSION_CLEANUP` () COMMENT '만료 세션 물리 삭제 배치 (08_API_COMMON.md 5.4, SESSION_CLEANUP_CRON)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_SESSION_CLEANUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : expired_at이 현재 시각보다 과거인 세션을 status와 무관하게 물리 삭제한다.
    --        만료 기간 값(JWT_REFRESH_EXPIRES_IN) 자체를 몰라도 되도록 expired_at은 로그인 시점에
    --        이미 절대시각으로 저장돼 있어(SP_USER_SESSION_CREATE), NOW()와 비교만 하면 된다.
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

    DELETE FROM `user_session` WHERE `expired_at` < NOW();

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
