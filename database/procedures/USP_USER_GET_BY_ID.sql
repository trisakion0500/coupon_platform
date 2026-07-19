DROP PROCEDURE IF EXISTS `USP_USER_GET_BY_ID`;

DELIMITER $$

CREATE PROCEDURE `USP_USER_GET_BY_ID` (
    IN i_user_id BIGINT UNSIGNED  -- 조회할 사용자 ID
)
COMMENT 'user_id로 전체 컬럼 조회 - GET /auth/me, 비밀번호 변경 시 현재 해시 조회 공용'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : USP_USER_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : GET /auth/me와 PATCH /auth/password(현재 비밀번호 검증용 해시 조회) 양쪽에서
    --        공용으로 쓰는 조회 SP. password_hash를 포함해 전체 컬럼을 그대로 반환하며,
    --        API 응답에 어떤 필드를 노출할지(예: password_hash 제외, phone_number 복호화)는
    --        서비스 레이어가 결정한다 — SP는 원본 데이터만 돌려준다.
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
        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `password_hash`,
            `user_name`, `email`, `phone_number`, `department`, `position`, `status`,
            `last_login_at`, `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;
