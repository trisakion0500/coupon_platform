DROP PROCEDURE IF EXISTS `SP_USER_ROLE_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_UPDATE` (
    IN i_user_id    BIGINT UNSIGNED,  -- 복합 PK - 사용자 ID
    IN i_project_id BIGINT UNSIGNED,  -- 복합 PK - 프로젝트 ID
    IN i_role_code  TINYINT UNSIGNED, -- 새 권한 코드 (NULL이면 미변경, 10은 불가)
    IN i_status     TINYINT UNSIGNED  -- 새 상태 (NULL이면 미변경)
) COMMENT 'user_role 수정 - 조건부 UPDATE, role_code=10 전환 차단 (12_USER_API.md 3.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user_id/project_id는 복합 PK라 이 SP에서 변경 대상이 아니다(Non-Updatable Fields,
    --        12_USER_API.md 3.3). role_code=10(SUPER_ADMIN)으로의 변경은 명시적으로 30003을
    --        반환한다(3.3 Business Rules) - DTO 레이어에서 20/30/40으로 막지 않고 여기서 막는
    --        이유는 문서가 이 케이스를 SP/서비스 레벨의 명시적 오류 코드로 지정했기 때문이다.
    --        물리 삭제 없음 원칙에 따라 권한 중지는 status=0 조건부 UPDATE로만 처리한다.
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
        IF i_role_code = 10 THEN
            SELECT 30003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM `user_role` WHERE `user_id` = i_user_id AND `project_id` = i_project_id
        ) THEN
            SELECT 31007 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `user_role`
        SET
            `role_code` = COALESCE(i_role_code, `role_code`),
            `status`    = COALESCE(i_status, `status`)
        WHERE `user_id` = i_user_id AND `project_id` = i_project_id;

        SELECT 0 AS RESULT;
        SELECT `user_id`, `project_id`, `role_code`, `status`, `created_at`, `updated_at`
        FROM `user_role`
        WHERE `user_id` = i_user_id AND `project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;
