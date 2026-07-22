DROP PROCEDURE IF EXISTS `SP_COUPON_CODE_GET_BY_VALUE`;
DELIMITER $$
CREATE PROCEDURE `SP_COUPON_CODE_GET_BY_VALUE` (
    IN i_project_id BIGINT UNSIGNED,  -- S2S 인증으로 스코핑된 project_id
    IN i_code_value  VARCHAR(50)      -- 조회할 코드값
) COMMENT '프로젝트+코드값으로 coupon_code 조회 (SP_COUPON_RESERVE/CONFIRM 실패 시 log_coupon_use용 campaign_id 보강 전용)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COUPON_CODE_GET_BY_VALUE
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : SP_COUPON_RESERVE/SP_COUPON_CONFIRM은 02_DEV_CONVENTIONS.md 3.4 규약상 실패 시
    --        RESULT 단일 컬럼만 반환하므로, 코드는 존재하지만 다른 사유로 실패한 경우(RESERVE의
    --        33001/33002/33003, CONFIRM의 31006)에도 coupon_campaign_id를 알 수 없다. 하지만
    --        log_coupon_use.coupon_campaign_id는 "코드 자체가 없는 시도만 NULL"이 설계 의도라
    --        (log_coupon_use.sql 헤더 주석), TS 서비스가 이 실패 분기에서만 별도로 이 SP를
    --        호출해 campaign_id를 보강한 뒤 로그를 남긴다(성공 경로/코드없음(31005) 경로는
    --        이 SP를 호출하지 않음 - RESERVE/CONFIRM 성공 시엔 각 SP가 이미 campaign_id를
    --        함께 반환하므로 불필요). 순수 로깅 보강용이라 결과를 못 찾아도(31005) TS는 그냥
    --        campaign_id=NULL로 로그를 남기면 그만이며 에러를 전파하지 않는다.
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
            SELECT 1 FROM `coupon_code`
            WHERE `project_id` = i_project_id AND `code_value` = i_code_value
        ) THEN
            SELECT 31005 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `coupon_code_id`, `coupon_campaign_id`, `status`
        FROM `coupon_code`
        WHERE `project_id` = i_project_id AND `code_value` = i_code_value;
    END proc_block;
END$$

DELIMITER ;
