DROP PROCEDURE IF EXISTS `SP_USER_PASSWORD_RESET`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_PASSWORD_RESET` (
    IN i_user_id           BIGINT UNSIGNED,  -- 대상 사용자 ID
    IN i_new_password_hash VARCHAR(255),     -- 새 비밀번호 bcrypt 해시(앱 레이어에서 해시 완료)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '관리자 비밀번호 강제 초기화 - SUPER_ADMIN 재검증, 전체 활성 세션 종료 (12_USER_API.md 1.7)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_PASSWORD_RESET
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : SP_USER_PASSWORD_CHANGE(09_AUTH_API.md 9장, 본인 비밀번호 변경)와 로직은 거의
    --        동일하지만, 이쪽은 대상 user_id가 URL 파라미터로 임의 지정되므로(호출자 본인이
    --        아님) 존재 확인(31003)이 먼저 필요하다는 점이 다르다 - 그래서 SP를 공유하지 않고
    --        별도로 둔다. 현재 비밀번호 검증 없이 즉시 변경하며(12_USER_API.md 1.7 Description),
    --        password_hash 갱신과 "모든 활성 세션 종료"를 하나의 트랜잭션으로 묶는다.
    --        비밀번호 강제 초기화는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다
    --        (password_hash는 변경 전/후 모두 '***'로 마스킹 — 13_LOG_AUDIT_API.md 2.4).
    --        2026-07-22: before_json 캡처가 START TRANSACTION보다 먼저(락 없이) 실행되던 문제를
    --        전수감사에서 발견 - 캡처를 트랜잭션 내부로 옮기고 `FOR UPDATE`로 바꿔 캡처 시점부터
    --        UPDATE까지 원자적으로 처리한다(SP_USER_UPDATE와 동일 수정).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        START TRANSACTION;

            SELECT JSON_OBJECT(
                'user_id', `user_id`, 'company_id', `company_id`,
                'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
                'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
                'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
                'status', `status`, 'last_login_at', `last_login_at`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) INTO v_before_json
            FROM `user` WHERE `user_id` = i_user_id
            FOR UPDATE;

            UPDATE `user`
            SET `password_hash` = i_new_password_hash
            WHERE `user_id` = i_user_id;

            UPDATE `user_session`
            SET `status` = 0
            WHERE `user_id` = i_user_id AND `status` = 1;

        COMMIT;

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
