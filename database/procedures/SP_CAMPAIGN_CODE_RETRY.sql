DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_RETRY`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_RETRY` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '코드 생성 재시도 - generation_status 4(실패)->2(진행중) 조건부 UPDATE (17_CAMPAIGN_API.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_RETRY
    -- 작성 : 2026.07.21 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001) ->
    --        "generation_status=4(실패) AND status<>4(1.3)" 조건부 UPDATE로 원자 처리한다
    --        (05_COUPON_ISSUANCE_SCENARIO.md 2.3). ROW_COUNT()=0이면 실패 상태가 아니거나(이미
    --        완료/진행중/대기) 캠페인이 종료됐다는 뜻 - 둘 다 30004(API 스펙도 사유를 구분하지
    --        않음). FIXED는 애초에 generation_status=4에 도달하지 않으므로(동기 즉시실패 처리,
    --        05_COUPON_ISSUANCE_SCENARIO.md 2.2) 이 SP가 실질적으로 호출될 대상은 RANDOM뿐이다.
    --        이미 생성된 generated_qty는 그대로 두고 TS 서비스가 남은 수량(requested_qty -
    --        generated_qty)만 이어서 생성하므로, 그 재개에 필요한 project_id/use_hyphen/
    --        requested_qty/generated_qty를 함께 반환한다. edit_count는 SP_CAMPAIGN_CODE_ISSUE와
    --        동일한 이유로 건드리지 않는다.
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
        SET `generation_status` = 2
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `generation_status` = 4
          AND `status` <> 4;

        IF ROW_COUNT() = 0 THEN
            SELECT 30004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `use_hyphen`, `requested_qty`,
            `generated_qty`, `generation_status`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;
