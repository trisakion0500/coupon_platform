DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_IDENTITY_BY_API_KEY`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_IDENTITY_BY_API_KEY` (
    IN i_api_key VARCHAR(64)  -- 조회할 API Key (project.api_key)
) COMMENT 'API Key -> {project_id, company_id}만 반환 (레이트리밋 로그 캐시미스 폴백 전용, docs/09_AUTH_SECURITY.md 2.8.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_IDENTITY_BY_API_KEY
    -- 작성 : 2026.08.05 trisakion
    -- 내용 : CouponUsageRateLimitMiddleware/CouponUsageUserRateLimitMiddleware가 429 리젝트를
    --        log_coupon_rate_limit에 기록할 때, api_key -> {project_id, company_id}를
    --        해석하는 Redis 캐시(project:apikey:{api_key})가 미스일 때 쓰는 폴백 조회다.
    --        SP_PROJECT_GET_BY_API_KEY(S2sAuthGuard 전용)를 재사용하지 않는 이유: 그 SP는
    --        api_secret/api_secret_prev(암호화돼 있어도 민감정보)까지 반환하는데, 이 SP는
    --        시크릿을 전혀 다룰 필요가 없는 순수 조회 경로라 굳이 그걸 거치게 하면 불필요한
    --        노출이 생긴다 - 그래서 ID 2개만 반환하는 좁은 목적 SP로 별도 분리했다
    --        (SP_PROJECT_CHECK_ACCESS와 같은 결).
    --        존재하지 않는 api_key(스캐닝성 트래픽 등)는 31002로 응답한다 - 호출부는 이 경우
    --        project_id/company_id를 NULL로 남긴 채 로그를 기록한다.
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
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `api_key` = i_api_key) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`project_id`,
            p.`company_id`
        FROM `project` p
        WHERE p.`api_key` = i_api_key;
    END proc_block;
END$$

DELIMITER ;
