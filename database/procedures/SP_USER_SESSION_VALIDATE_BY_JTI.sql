DROP PROCEDURE IF EXISTS `SP_USER_SESSION_VALIDATE_BY_JTI`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_VALIDATE_BY_JTI` (
    IN i_access_token_jti VARCHAR(100)  -- 검증할 Access Token의 JTI
) COMMENT 'JwtAuthGuard 전용 - 세션/사용자 상태 검증 (09_AUTH_SECURITY.md 1.5 3~4번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_VALIDATE_BY_JTI
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 보호된 API 요청마다 JwtAuthGuard가 호출하는 세션/사용자 상태 검증
    --        (09_AUTH_SECURITY.md 1.5 "3. Session 확인 / 4. User 상태 확인").
    --        role_code는 여기서 다시 조회하지 않는다 — Access Token(JWT) 자체가 이미 서명으로
    --        보증된 role_code를 담고 있어, 매 요청마다 user_role을 다시 조인하는 건 불필요한 비용이다
    --        (role_code는 로그인/재발급 시점에만 재계산, 11_AUTH_API.md 7장 참고).
    --        세션이 없거나 로그아웃(status!=1)되었거나 만료(expired_at<=NOW())된 경우
    --        10009(유효하지 않은 Session)를 반환한다 — expired_at 체크가 없으면 세션 만료 이후에도
    --        그 직전에 발급된 Access Token이 자기 수명(15분)이 남아있는 동안 계속 통과해버리는
    --        구멍이 생긴다(2026-07-19 리뷰에서 발견, SP_USER_SESSION_GET_BY_REFRESH_HASH와
    --        동일하게 맞춤).
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
            WHERE `access_token_jti` = i_access_token_jti AND `status` = 1 AND `expired_at` > NOW()
        ) THEN
            SELECT 10009 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT u.`user_id`, u.`company_id`, u.`status` AS user_status
        FROM `user_session` s
        JOIN `user` u ON s.`user_id` = u.`user_id`
        WHERE s.`access_token_jti` = i_access_token_jti AND s.`status` = 1 AND s.`expired_at` > NOW();
    END proc_block;
END$$

DELIMITER ;
