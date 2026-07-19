DROP PROCEDURE IF EXISTS `SP_PROJECT_API_SECRET_CLEANUP`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_API_SECRET_CLEANUP` (
    IN i_grace_period_days INT UNSIGNED  -- 유예기간(일) — API_SECRET_GRACE_PERIOD_DAYS
) COMMENT '유예기간 지난 api_secret_prev 정리 배치 (07_AUTH_SECURITY.md 2.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_API_SECRET_CLEANUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : Secret Rotation Grace Period 방식(07_AUTH_SECURITY.md 2.6)의 정리 배치.
    --        secret_rotated_at + i_grace_period_days가 지난 행의 api_secret_prev를 NULL
    --        처리한다 — 그 이후에는 이전 Secret으로 서명해도 더 이상 통과시키지 않는다
    --        (S2sAuthGuard.verifySignature가 api_secret_prev가 NULL이면 아예 후보에서 제외).
    --        SP_SESSION_CLEANUP과 동일하게 서버 기동 시 ApiSecretCleanupService가 크론으로 호출한다.
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

    UPDATE `project`
    SET `api_secret_prev` = NULL
    WHERE `api_secret_prev` IS NOT NULL
      AND `secret_rotated_at` IS NOT NULL
      AND `secret_rotated_at` <= NOW() - INTERVAL i_grace_period_days DAY;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
