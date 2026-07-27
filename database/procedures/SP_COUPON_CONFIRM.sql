DROP PROCEDURE IF EXISTS `SP_COUPON_CONFIRM`;
DELIMITER $$
CREATE PROCEDURE `SP_COUPON_CONFIRM` (
    IN i_project_id   BIGINT UNSIGNED,  -- S2S 인증으로 스코핑된 project_id
    IN i_code_value   VARCHAR(50),      -- coupon_code.code_value
    IN i_game_user_id VARCHAR(100)      -- 게임서버 유저 식별자
) COMMENT '쿠폰 사용 지급결과 기록 - confirm (20_COUPON_USAGE_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COUPON_CONFIRM
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : 08_COUPON_USAGE_SCENARIO.md 2.1(confirm 흐름도)/2.2(중복 호출 무해)를 그대로
    --        구현한다. confirm은 coupon_code/coupon_campaign 어떤 상태도 바꾸지 않으므로(소모
    --        확정은 이미 reserve에서 끝남) 별도 락이 필요 없다 - 재시도로 두 번 호출돼도
    --        confirmed_at을 같은 값으로 다시 쓰는 것뿐이라 무해하다.
    --        1) 코드 조회(project_id+code_value) - 없으면 31005
    --        2) coupon_code_usage 조회(coupon_code_id+game_user_id 매칭) - 없으면 31006
    --           (reserve를 먼저 호출한 적 없거나, reserve 때와 다른 game_user_id로 호출한 경우)
    --        3) 이미 confirmed_at이 있으면 그대로 재반환(멱등), 없으면 조건부 UPDATE(`WHERE
    --           confirmed_at IS NULL`)로 기록 후 재조회해 반환 - 조건부 UPDATE로 감싼 것은
    --           동시 confirm 호출 시 ROW_COUNT()=0이 나더라도(=경쟁에서 짐) 에러로 취급하지
    --           않고 그냥 결과를 다시 읽어 그대로 반환하기 위함(둘 다 성공 응답을 받는 것이
    --           의도된 동작, 04_DEV_CONVENTIONS.md 4장의 "조건부 UPDATE 우선" 원칙을 따르되
    --           실패를 별도 분기로 두지 않는 경우).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_coupon_code_id     BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_coupon_campaign_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_usage_id           BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_confirmed_at       DATETIME        DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SELECT `coupon_code_id`, `coupon_campaign_id` INTO v_coupon_code_id, v_coupon_campaign_id
        FROM `coupon_code`
        WHERE `project_id` = i_project_id AND `code_value` = i_code_value;

        IF v_coupon_code_id IS NULL THEN
            SELECT 31005 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `coupon_code_usage_id`, `confirmed_at` INTO v_usage_id, v_confirmed_at
        FROM `coupon_code_usage`
        WHERE `coupon_code_id` = v_coupon_code_id AND `game_user_id` = i_game_user_id
        LIMIT 1;

        IF v_usage_id IS NULL THEN
            SELECT 31006 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF v_confirmed_at IS NULL THEN
            UPDATE `coupon_code_usage` SET `confirmed_at` = NOW()
            WHERE `coupon_code_usage_id` = v_usage_id AND `confirmed_at` IS NULL;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `coupon_code_usage_id`, v_coupon_campaign_id AS `coupon_campaign_id`, `confirmed_at`
        FROM `coupon_code_usage`
        WHERE `coupon_code_usage_id` = v_usage_id;
    END proc_block;
END$$

DELIMITER ;
