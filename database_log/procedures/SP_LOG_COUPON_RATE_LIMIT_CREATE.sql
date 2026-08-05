DROP PROCEDURE IF EXISTS `SP_LOG_COUPON_RATE_LIMIT_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_COUPON_RATE_LIMIT_CREATE` (
    IN i_limit_scope     TINYINT UNSIGNED,  -- 리밋 종류 (10:PROJECT, 20:USER)
    IN i_action          TINYINT UNSIGNED,  -- 요청 유형 (10:RESERVE, 20:CONFIRM)
    IN i_api_key         VARCHAR(64),       -- 요청 헤더 원문 API Key
    IN i_project_id      BIGINT UNSIGNED,   -- 해석된 프로젝트 ID (미해석 시 NULL)
    IN i_company_id      BIGINT UNSIGNED,   -- 해석된 회사 ID (미해석 시 NULL)
    IN i_game_user_id    VARCHAR(100),      -- USER 스코프에서만 값 존재, 그 외 NULL
    IN i_retry_after_sec SMALLINT UNSIGNED, -- 거부 시점에 반환한 Retry-After 값(초)
    IN i_caller_ip       VARCHAR(45)        -- 호출한 게임서버의 IP (NULL 가능)
) COMMENT '쿠폰 사용 레이트리밋 초과(429) 이력 적재 (Append-Only, docs/09_AUTH_SECURITY.md 2.8)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_COUPON_RATE_LIMIT_CREATE
    -- 작성 : 2026.08.05 trisakion
    -- 내용 : log_coupon_rate_limit 단순 INSERT. SP_LOG_COUPON_USE_CREATE와 동일하게 로그 DB
    --        (coupon_platform_log)에서만 실행되며, CouponUsageRateLimitMiddleware/
    --        CouponUsageUserRateLimitMiddleware가 429를 반환할 때 fire-and-forget으로
    --        호출한다 - 429 응답 자체는 이 호출을 기다리지 않는다. 권한 검증 없음 - 외부(HTTP)에
    --        직접 노출되지 않는 백엔드 내부 인프라 호출 전용(SP_LOG_COUPON_USE_CREATE와 동일한
    --        이유). 데이터 반환용 두 번째 SELECT는 필요 없다(04_DEV_CONVENTIONS.md 3.4 예외 -
    --        SP_LOG_AUDIT_CREATE와 동일).
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

    INSERT INTO `log_coupon_rate_limit` (
        `limit_scope`, `action`, `api_key`, `project_id`, `company_id`, `game_user_id`,
        `retry_after_sec`, `caller_ip`
    ) VALUES (
        i_limit_scope, i_action, i_api_key, i_project_id, i_company_id, i_game_user_id,
        i_retry_after_sec, i_caller_ip
    );

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
