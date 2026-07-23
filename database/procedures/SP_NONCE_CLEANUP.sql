DROP PROCEDURE IF EXISTS `SP_NONCE_CLEANUP`;
DELIMITER $$
CREATE PROCEDURE `SP_NONCE_CLEANUP` (
    IN i_tolerance_sec INT UNSIGNED  -- 허용 타임스탬프 범위(초) — S2S_TIMESTAMP_TOLERANCE_SEC
) COMMENT 'S2S nonce 정리 배치 - 허용 타임스탬프 범위보다 과거인 행 물리 삭제 (project_api_nonce.sql, S2S_NONCE_CLEANUP_CRON)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_NONCE_CLEANUP
    -- 작성 : 2026.07.23 trisakion
    -- 내용 : X-API-Timestamp 허용범위(S2S_TIMESTAMP_TOLERANCE_SEC)를 벗어난 요청은 서명 검증
    --        단계에서 이미 거부되므로(07_AUTH_SECURITY.md 2장), created_at이 그 범위보다 과거인
    --        nonce는 재사용(재전송)될 위협이 없어 물리 삭제해도 안전하다(project_api_nonce.sql
    --        헤더 주석 참고). SP_SESSION_CLEANUP/SP_PROJECT_API_SECRET_CLEANUP과 동일하게
    --        서버 크론(NonceCleanupService)만 호출하는 내부 배치 전용 SP라 호출자 권한 검증이
    --        없다.
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

    DELETE FROM `project_api_nonce`
    WHERE `created_at` < (NOW() - INTERVAL i_tolerance_sec SECOND);

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
