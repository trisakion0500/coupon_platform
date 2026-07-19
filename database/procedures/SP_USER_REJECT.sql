DROP PROCEDURE IF EXISTS `SP_USER_REJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_REJECT` (
    IN i_user_id BIGINT UNSIGNED  -- 반려할 사용자 ID
) COMMENT '가입반려 - status 0(대기) -> 2(반려) 조건부 UPDATE (12_USER_API.md 1.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_REJECT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : SP_USER_APPROVE와 동일한 조건부 UPDATE + 실패 사유 진단 패턴(31003 vs 30004).
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
        UPDATE `user`
        SET `status` = 2
        WHERE `user_id` = i_user_id AND `status` = 0;

        IF ROW_COUNT() = 0 THEN
            IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
                SELECT 31003 AS RESULT;
            ELSE
                SELECT 30004 AS RESULT;
            END IF;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;
