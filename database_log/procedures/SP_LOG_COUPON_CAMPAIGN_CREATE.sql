DROP PROCEDURE IF EXISTS `SP_LOG_COUPON_CAMPAIGN_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_COUPON_CAMPAIGN_CREATE` (
    IN i_action              TINYINT UNSIGNED, -- 작업유형 (10:CREATE,20:UPDATE,30:STATUS_CHANGE,40:APPROVE,50:REJECT)
    IN i_coupon_campaign_id  BIGINT UNSIGNED,  -- 원본 캠페인 ID
    IN i_project_id          BIGINT UNSIGNED,  -- 프로젝트 ID (스냅샷)
    IN i_name                VARCHAR(100),     -- 캠페인명 (스냅샷)
    IN i_campaign_start      DATETIME,         -- 시작일시 (스냅샷)
    IN i_campaign_end        DATETIME,         -- 종료일시 (스냅샷)
    IN i_code_type           TINYINT UNSIGNED, -- 코드 발급 방식 (스냅샷)
    IN i_use_hyphen          TINYINT UNSIGNED, -- 하이픈 포함 여부 (스냅샷)
    IN i_requested_qty       INT UNSIGNED,     -- 목표 발급 수량 (스냅샷)
    IN i_generated_qty       INT UNSIGNED,     -- 실제 발급 수량 (스냅샷)
    IN i_usable_qty          INT UNSIGNED,     -- 실제 사용가능 수량 (스냅샷)
    IN i_used_qty            INT UNSIGNED,     -- 실제 사용 수량 (스냅샷)
    IN i_use_limit_per_user  INT UNSIGNED,     -- 재사용 허용 횟수 (스냅샷)
    IN i_status              TINYINT UNSIGNED, -- 상태 (스냅샷)
    IN i_approval_status     TINYINT UNSIGNED, -- 승인상태 (스냅샷)
    IN i_approved_by         BIGINT UNSIGNED,  -- 승인/반려 처리자 ID (스냅샷, NULL 가능)
    IN i_approved_at         DATETIME,         -- 승인/반려 처리일시 (스냅샷, NULL 가능)
    IN i_reject_reason       VARCHAR(500),     -- 반려 사유 (스냅샷, NULL 가능)
    IN i_reward_data         JSON,             -- 보상 내용 (스냅샷)
    IN i_created_by          BIGINT UNSIGNED   -- 이 로그 행(액션)을 수행한 사용자 ID
) COMMENT '쿠폰 캠페인 변경 이력 적재 (Append-Only, 04_DATABASE_SCHEMA.md 10장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_COUPON_CAMPAIGN_CREATE
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : log_coupon_campaign 단순 INSERT. 이 SP는 로그 DB(coupon_platform_log)에서만
    --        실행되며, 메인 DB(coupon_platform)와 물리적으로 분리돼 있어 메인 도메인 SP
    --        (SP_CAMPAIGN_CREATE 등)가 직접 호출할 수 없다(02_DEV_CONVENTIONS.md 1장) - 그래서
    --        메인 도메인 SP가 반환한 캠페인 행 전체를 TS(LogSpExecutorService.logCall)가 그대로
    --        전달하기만 한다. log_audit(SP_LOG_AUDIT_CREATE)와 달리 before_json/after_json
    --        JSON 스냅샷 방식이 아니라 coupon_campaign 컬럼을 그대로 복제하는 구조라
    --        (04_DATABASE_SCHEMA.md 10장 - 타입 보존, JSON 파싱 없이 특정 시점 특정 컬럼 값을
    --        바로 조회 가능) before 상태 캡처 자체가 필요 없다 - 매 액션마다 "그 시점의 최종
    --        상태" 한 장만 남기면 된다. created_by_name 스냅샷 컬럼도 없다(log_audit과 다른 점)
    --        - 이 로그는 MANAGER/OPERATOR 등 캠페인 당사자가 직접 조회하는 화면이라 필요 시
    --        created_by(user_id)로 조회 시점에 조인하면 되고, 별도 스냅샷을 남기지 않기로
    --        확정했다(17_CAMPAIGN_API.md 4장 범위 밖 - 이 로그의 조회 API 자체는 별도 작업).
    --        권한 검증이 없다 - 외부(HTTP)에 직접 노출되지 않는 백엔드 내부 인프라 호출 전용이고,
    --        호출 시점엔 이미 메인 도메인 SP의 권한 검증이 끝난 뒤이기 때문이다. 로그 적재 실패가
    --        메인 트랜잭션에 영향을 주면 안 되므로(LogSpExecutorService.logCall이 예외를 잡아
    --        삼킨다) 이 SP 자체는 RESULT=0/50001만 있으면 충분하고, 데이터 반환용 두 번째
    --        SELECT는 필요 없다(02_DEV_CONVENTIONS.md 3.4 예외 - SP_LOG_AUDIT_CREATE와 동일).
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

    INSERT INTO `log_coupon_campaign` (
        `action`, `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
        `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `usable_qty`, `used_qty`,
        `use_limit_per_user`, `status`, `approval_status`, `approved_by`, `approved_at`,
        `reject_reason`, `reward_data`, `created_by`
    ) VALUES (
        i_action, i_coupon_campaign_id, i_project_id, i_name, i_campaign_start, i_campaign_end,
        i_code_type, i_use_hyphen, i_requested_qty, i_generated_qty, i_usable_qty, i_used_qty,
        i_use_limit_per_user, i_status, i_approval_status, i_approved_by, i_approved_at,
        i_reject_reason, i_reward_data, i_created_by
    );

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
