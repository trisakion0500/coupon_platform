DROP PROCEDURE IF EXISTS `SP_USER_PASSWORD_CHANGE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_PASSWORD_CHANGE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 대상 사용자 ID
    IN i_new_password_hash VARCHAR(255)       -- 새 비밀번호 bcrypt 해시(앱 레이어에서 해시 완료)
) COMMENT '비밀번호 변경 + 전체 활성 세션 강제 로그아웃 (09_AUTH_API.md 9장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_PASSWORD_CHANGE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 현재 비밀번호 검증(bcrypt.compare)은 앱 레이어에서 이미 끝난 상태로 호출된다.
    --        password_hash 갱신과 "모든 활성 세션 종료"(07_AUTH_SECURITY.md 1.3)를 하나의
    --        트랜잭션으로 처리해, 비밀번호는 바뀌었는데 기존 세션이 살아있는 상태가 생기지 않게 한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    START TRANSACTION;

        UPDATE `user`
        SET `password_hash` = i_new_password_hash
        WHERE `user_id` = i_user_id;

        UPDATE `user_session`
        SET `status` = 0
        WHERE `user_id` = i_user_id AND `status` = 1;

    COMMIT;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
