DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_GET_BY_ID` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 조회할 캠페인 ID
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 단건 조회 - 미존재 31004, 스코핑 범위 밖 20001 (19_CAMPAIGN_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_GET_BY_ID
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 존재 확인(31004) -> project_id 조회 -> 프로젝트 스코핑 재검증(20001) 순으로 처리한다.
    --        19_CAMPAIGN_API.md 1.2/2.3 — "존재하지 않음"과 "스코핑 범위 밖"을 분리해서 각각
    --        31004/20001로 응답한다(2026-07-20 문서 정정 — 이전에 2.3/4.1에 남아있던 "둘 다
    --        31004" 서술은 1.2 일반 원칙과 어긋난 오기였고, 사용자 확인 후 20001로 통일함 —
    --        company/project/user 도메인의 "스코핑 밖=20001" 선례와도 일치).
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

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`, `edit_count`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;
