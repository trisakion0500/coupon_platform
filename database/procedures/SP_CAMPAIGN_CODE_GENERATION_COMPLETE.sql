DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_GENERATION_COMPLETE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_GENERATION_COMPLETE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED  -- 대상 캠페인 ID
) COMMENT 'RANDOM 코드 생성 완료 처리(내부용) - generation_status 2->3 조건부 UPDATE (05_COUPON_ISSUANCE_SCENARIO.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_GENERATION_COMPLETE
    -- 작성 : 2026.07.21 trisakion
    -- 내용 : TS 백그라운드 루프가 generated_qty=requested_qty에 도달했을 때 호출한다
    --        (SP_CAMPAIGN_CODE_GENERATE_ONE과 동일하게 요청자 재검증 없음 - 내부 배치 전용).
    --        WHERE절에 generation_status=2를 걸어 이미 완료/실패 처리된 캠페인을 중복 전이하지
    --        않도록 조건부 UPDATE로 처리한다.
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
        UPDATE `coupon_campaign`
        SET `generation_status` = 3
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `generation_status` = 2;

        SELECT 0 AS RESULT;
        SELECT `coupon_campaign_id`, `generation_status`
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;
