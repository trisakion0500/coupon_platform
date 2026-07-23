DROP PROCEDURE IF EXISTS `SP_LOG_COUPON_USE_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_COUPON_USE_CREATE` (
    IN i_action              TINYINT UNSIGNED, -- 요청 유형 (10:RESERVE, 20:CONFIRM)
    IN i_project_id          BIGINT UNSIGNED,  -- 프로젝트 ID (S2S 인증으로 스코핑된 값)
    IN i_coupon_campaign_id  BIGINT UNSIGNED,  -- 캠페인 ID (코드 자체가 없는 시도는 NULL)
    IN i_code_value          VARCHAR(50),      -- 시도한 쿠폰 코드 문자열 원문
    IN i_game_user_id        VARCHAR(100),     -- 게임서버 유저 식별자
    IN i_result_type         TINYINT UNSIGNED, -- 처리 결과 (0:성공,10:코드없음,20:이미소모/중지,30:캠페인사용불가,40:사용자한도초과,50:소모기록없음)
    IN i_caller_ip           VARCHAR(45)       -- 호출한 게임서버의 IP(IPv6 포함, NULL 가능) — 인증 목적 아님, 이상징후 탐지/장애조사 보조용
) COMMENT '쿠폰 사용(reserve/confirm) 시도 이력 적재 (Append-Only, 18_COUPON_USAGE_API.md 1.5/4장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_COUPON_USE_CREATE
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : log_coupon_use 단순 INSERT. SP_LOG_COUPON_CAMPAIGN_CREATE와 동일하게 로그 DB
    --        (coupon_platform_log)에서만 실행되며, 메인 도메인 SP(SP_COUPON_RESERVE/CONFIRM)가
    --        직접 호출할 수 없어(02_DEV_CONVENTIONS.md 1장 - 물리적으로 분리된 별도 DB) TS
    --        서비스(CouponUsageService)가 메인 SP 호출 결과를 보고 성공/실패 여부와 무관하게
    --        매 호출마다 이 SP를 fire-and-forget으로 호출한다(18_COUPON_USAGE_API.md 1.5).
    --        log_coupon_campaign과 달리 성공한 소모 건의 스냅샷이 아니라 "시도 자체"의 기록이라
    --        RESERVE/CONFIRM 요청 바디 값(project_id/code_value/game_user_id)과 결과
    --        (result_type)만 담는다 - 실패 시엔 관련 도메인 행 자체가 없거나(코드없음) 바뀌지
    --        않으므로(다른 실패) 스냅샷 개념이 성립하지 않는다. 권한 검증 없음 - 외부(HTTP)에
    --        직접 노출되지 않는 백엔드 내부 인프라 호출 전용(SP_LOG_COUPON_CAMPAIGN_CREATE와
    --        동일한 이유). 데이터 반환용 두 번째 SELECT는 필요 없다(02_DEV_CONVENTIONS.md 3.4
    --        예외 - SP_LOG_AUDIT_CREATE와 동일).
    -- 수정1: 2026.07.23 trisakion — caller_ip 컬럼 추가에 맞춰 i_caller_ip 파라미터를 받아 그대로
    --        INSERT한다. TS(CouponUsageController)가 Express req.ip(main.ts trust proxy=1
    --        설정으로 로드밸런서 뒤에서도 실제 호출자 IP)를 캡처해 넘긴다 - 이 SP는 값을 그대로
    --        저장만 할 뿐 검증/가공하지 않는다.
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

    INSERT INTO `log_coupon_use` (
        `action`, `project_id`, `coupon_campaign_id`, `code_value`, `game_user_id`, `result_type`,
        `caller_ip`
    ) VALUES (
        i_action, i_project_id, i_coupon_campaign_id, i_code_value, i_game_user_id, i_result_type,
        i_caller_ip
    );

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
