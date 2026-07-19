DROP PROCEDURE IF EXISTS `SP_USER_APPROVE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_APPROVE` (
    IN i_user_id BIGINT UNSIGNED  -- 승인할 사용자 ID
) COMMENT '가입승인 - status 0(대기) -> 1(승인) 조건부 UPDATE (12_USER_API.md 1.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_APPROVE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 조건부 UPDATE(WHERE status=0)를 먼저 시도해 체크 후 갱신(check-then-act) 대신
    --        원자적으로 처리한다(02_DEV_CONVENTIONS.md 4장). 영향받은 행이 0건일 때만 그 이유를
    --        진단한다 - 사용자 자체가 없으면 31003, 있는데 이미 status=0이 아니면(이미 처리됨)
    --        30004(상태 전이 불가)로 구분한다. 이렇게 하면 성공 경로(가장 흔한 경우)는 존재
    --        여부를 별도로 조회하지 않고 UPDATE 한 번으로 끝난다.
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
        SET `status` = 1
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
