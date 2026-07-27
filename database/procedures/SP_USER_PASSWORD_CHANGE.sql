DROP PROCEDURE IF EXISTS `SP_USER_PASSWORD_CHANGE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_PASSWORD_CHANGE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 대상 사용자 ID
    IN i_new_password_hash VARCHAR(255)       -- 새 비밀번호 bcrypt 해시(앱 레이어에서 해시 완료)
) COMMENT '비밀번호 변경 + 전체 활성 세션 강제 로그아웃 (11_AUTH_API.md 9장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_PASSWORD_CHANGE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 현재 비밀번호 검증(bcrypt.compare)은 앱 레이어에서 이미 끝난 상태로 호출된다.
    --        password_hash 갱신과 "모든 활성 세션 종료"(09_AUTH_SECURITY.md 1.3)를 하나의
    --        트랜잭션으로 처리해, 비밀번호는 바뀌었는데 기존 세션이 살아있는 상태가 생기지 않게 한다.
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 데이터 result set(before_json/after_json/requester_name)을 신규로 추가했다
    --        (15_LOG_AUDIT_API.md 2.4 — 본인 비밀번호 변경도 user UPDATE 감사 로그 대상). 본인
    --        조회라 requester_name도 i_user_id 자신의 user_name이다. password_hash는 '***'로
    --        마스킹한다.
    --        2026-07-22: before_json 캡처가 START TRANSACTION보다 먼저(락 없이) 실행되던 문제를
    --        전수감사에서 발견 - 캡처를 트랜잭션 내부로 옮기고 `FOR UPDATE`로 바꿔 캡처 시점부터
    --        UPDATE까지 원자적으로 처리한다(SP_USER_UPDATE/PASSWORD_RESET과 동일 수정).
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
        v_before_json AS before_json,
        JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) AS after_json,
        `user_name` AS requester_name
    FROM `user`
    WHERE `user_id` = i_user_id;
END$$

DELIMITER ;
