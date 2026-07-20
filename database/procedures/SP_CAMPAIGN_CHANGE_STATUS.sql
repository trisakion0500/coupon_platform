DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CHANGE_STATUS`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CHANGE_STATUS` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_status             TINYINT UNSIGNED, -- 전환할 목표 상태
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 상태변경 - 전이표 전체를 하나의 조건부 UPDATE로 원자 처리 (17_CAMPAIGN_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CHANGE_STATUS
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001, role_code
    --        값 자체는 필요 없어 FN_GET_PROJECT_ROLE_CODE 대신 boolean 버전을 쓴다) -> 허용된
    --        전이표(17_CAMPAIGN_API.md 2.5) 전체를 WHERE절 하나에 담아 조건부 UPDATE로 원자
    --        처리한다(02_DEV_CONVENTIONS.md 4장 "동시성이 필요한 UPDATE는 조건부 갱신 우선").
    --        조건부 UPDATE 하나로 "현재 status가 무엇이든, 그 status에서 목표 status로의 전이가
    --        허용되는지 + (활성화 전이면) 승인 여부"까지 동시에 검증하므로, 상태를 먼저 읽어와
    --        다시 비교하는 check-then-act 없이 동시 요청에도 안전하다. ROW_COUNT()=0이면(존재/
    --        권한은 이미 통과했으므로) 남은 원인은 오직 "허용되지 않는 전이"뿐이라 30004로 확정
    --        할 수 있다. i_status가 전이표에 아예 없는 값이어도 WHERE절의 어떤 OR 분기와도
    --        매칭되지 않아 자연스럽게 0건으로 걸러진다.
    --        log_coupon_campaign(action=30 STATUS_CHANGE) 기록은 SP_CAMPAIGN_CREATE와 동일한
    --        이유로 이 SP가 직접 하지 않는다 - 반환 행 전체를 TS 서비스가
    --        SP_LOG_COUPON_CAMPAIGN_CREATE(로그 DB)에 그대로 전달한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id
        ) THEN
            SELECT 31004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `project_id` INTO v_project_id
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_PROJECT_ACCESS(i_requester_user_id, v_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `coupon_campaign`
        SET `status` = i_status, `updated_by` = i_requester_user_id
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND (
              (`status` = 1 AND i_status = 2 AND `approval_status` IN (1, 3)) OR
              (`status` = 1 AND i_status = 4) OR
              (`status` = 2 AND i_status = 3) OR
              (`status` = 2 AND i_status = 4) OR
              (`status` = 3 AND i_status = 2 AND `approval_status` IN (1, 3)) OR
              (`status` = 3 AND i_status = 4)
          );

        IF ROW_COUNT() = 0 THEN
            SELECT 30004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;
