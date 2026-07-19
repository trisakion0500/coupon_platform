DROP PROCEDURE IF EXISTS `SP_USER_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_UPDATE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 수정할 사용자 ID
    IN i_user_name         VARCHAR(100),     -- 새 사용자명 (NULL이면 미변경)
    IN i_email             VARCHAR(200),     -- 새 이메일 (NULL이면 미변경)
    IN i_phone_number_enc  VARCHAR(255),     -- 새 휴대폰번호 AES-256-CBC 암호화값 (NULL이면 미변경)
    IN i_department        VARCHAR(100),     -- 새 부서 (NULL이면 미변경)
    IN i_position          VARCHAR(100),     -- 새 직급 (NULL이면 미변경)
    IN i_status            TINYINT UNSIGNED, -- 새 상태 (NULL이면 미변경)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '사용자 정보 수정 - SUPER_ADMIN 재검증, 조건부 UPDATE + status=3 전환 시 전체 세션 종료 (12_USER_API.md 1.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id/requested_project_id/login_id는 이 SP의 파라미터에 아예 없다 - 수정 불가
    --        필드라 애초에 받지 않는다(12_USER_API.md 1.6 Non-Updatable Fields). 존재 확인(31003)
    --        -> email 변경 시 중복 확인(자기 자신 제외, 32001) -> COALESCE 기반 조건부 UPDATE
    --        (02_DEV_CONVENTIONS.md 4장). email 유니크 제약 위반(1062) 백스톱도 CREATE/UPDATE류
    --        SP와 동일한 이유로 둔다.
    --        i_status=3(사용중지)으로 전환하는 경우에만 해당 사용자의 활성 세션을 전부 종료한다
    --        (12_USER_API.md 1.6 Business Rules, 07_AUTH_SECURITY.md 1.3) - 이미 3이었거나 다른
    --        값으로 바뀌는 경우는 세션에 영향을 주지 않는다. UPDATE 규약(3.4)은 status 값 전이
    --        자체를 검증하지 않는다고 명시하므로(화면 버튼 기준일 뿐) 여기서도 임의의 status 값
    --        전달을 그대로 허용한다.
    --        사용자 수정은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    -- email 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

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

        IF i_email IS NOT NULL AND EXISTS (
            SELECT 1 FROM `user` WHERE `email` = i_email AND `user_id` <> i_user_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        START TRANSACTION;

            UPDATE `user`
            SET
                `user_name`    = COALESCE(i_user_name, `user_name`),
                `email`        = COALESCE(i_email, `email`),
                `phone_number` = COALESCE(i_phone_number_enc, `phone_number`),
                `department`   = COALESCE(i_department, `department`),
                `position`     = COALESCE(i_position, `position`),
                `status`       = COALESCE(i_status, `status`)
            WHERE `user_id` = i_user_id;

            IF i_status = 3 THEN
                UPDATE `user_session`
                SET `status` = 0
                WHERE `user_id` = i_user_id AND `status` = 1;
            END IF;

        COMMIT;

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
