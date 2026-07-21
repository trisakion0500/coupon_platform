DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_GENERATION_FAIL`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_GENERATION_FAIL` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_generation_error   VARCHAR(500)      -- 최종 실패 사유(마지막 재시도의 오류 메시지)
) COMMENT 'RANDOM 코드 생성 최종 실패 처리(내부용) - generation_status 2->4 조건부 UPDATE (05_COUPON_ISSUANCE_SCENARIO.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_GENERATION_FAIL
    -- 작성 : 2026.07.21 trisakion
    -- 내용 : TS 백그라운드 루프가 exponential backoff+jitter 재시도를 모두 소진했을 때 호출한다
    --        (SP_CAMPAIGN_CODE_GENERATE_ONE과 동일하게 요청자 재검증 없음 - 내부 배치 전용).
    --        개별 재시도 시도 자체는 이 테이블에 남기지 않고 애플리케이션 로그로만 남긴다
    --        (05_COUPON_ISSUANCE_SCENARIO.md 2.2 표 - "재시도 소진" 행). WHERE절에
    --        generation_status=2를 걸어 이미 완료 처리된 캠페인을 뒤늦게 실패로 덮어쓰지 않는다.
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
        SET `generation_status` = 4, `generation_error` = i_generation_error
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `generation_status` = 2;

        SELECT 0 AS RESULT;
        SELECT `coupon_campaign_id`, `generation_status`, `generation_error`
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;
