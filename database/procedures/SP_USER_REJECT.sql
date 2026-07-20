DROP PROCEDURE IF EXISTS `SP_USER_REJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_REJECT` (
    IN i_user_id           BIGINT UNSIGNED,  -- 반려할 사용자 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '가입반려 - SUPER_ADMIN 재검증, status 0(대기) -> 2(반려) 조건부 UPDATE (12_USER_API.md 1.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_REJECT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : SP_USER_APPROVE와 동일한 조건부 UPDATE + 실패 사유 진단 패턴(31003 vs 30004),
    --        그리고 동일한 FN_IS_SUPER_ADMIN 재검증(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 SP_USER_APPROVE와 동일하게 UPDATE 직전
    --        v_before_json 캡처 + 결과 SELECT에 before_json/after_json/requester_name 추가
    --        (password_hash '***' 마스킹).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user` WHERE `user_id` = i_user_id;

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
            `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', `user_id`, 'company_id', `company_id`,
                'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
                'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
                'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
                'status', `status`, 'last_login_at', `last_login_at`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;
