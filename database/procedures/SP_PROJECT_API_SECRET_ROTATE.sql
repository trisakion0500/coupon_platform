DROP PROCEDURE IF EXISTS `SP_PROJECT_API_SECRET_ROTATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_API_SECRET_ROTATE` (
    IN i_project_id      BIGINT UNSIGNED,  -- 재발급 대상 프로젝트 ID
    IN i_user_id         BIGINT UNSIGNED,  -- 요청자 user_id (JWT 페이로드 값 그대로 신뢰)
    IN i_new_api_secret_enc VARCHAR(255)   -- 새 API Secret AES-256-CBC 암호화값 (앱 레이어에서 암호화 완료)
) COMMENT 'API Secret 재발급 - Grace Period 방식 (11_PROJECT_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_API_SECRET_ROTATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 존재 확인(31002) 후, FN_IS_SUPER_ADMIN(i_user_id)이 아니면 FN_CHECK_PROJECT_ACCESS로
    --        해당 project_id에 실제 활성 user_role 배정이 있는지 재검증한다(11_PROJECT_API.md 2.5
    --        Business Rules — JWT의 role_code는 여러 프로젝트 중 최고 권한 하나뿐이라 이 project_id
    --        기준으로는 다시 확인해야 함). 원래는 앱이 전달한 i_role_code로 SUPER_ADMIN 우회를
    --        판단했으나, 02_DEV_CONVENTIONS.md 3.2 정책(SP는 호출자의 role_code 값을 앱으로부터
    --        전달받아 신뢰하지 않는다) 전면 적용 때 이 SP만 누락돼 있던 것을 2026-07-19 감사에서
    --        발견해 FN_IS_SUPER_ADMIN 재확인으로 교체했다(API Secret 재발급은 보안 민감 기능이라
    --        다른 SP보다 오히려 더 엄격해야 함). 통과하면 기존 api_secret을 api_secret_prev로 옮기고
    --        신규 값을 api_secret에 저장, secret_rotated_at을 갱신한다(07_AUTH_SECURITY.md 2.6
    --        Grace Period 방식). api_key는 변경하지 않는다. 반환 컬럼에 api_secret(암호문)은
    --        포함하지 않는다 — 평문은 앱 레이어가 자신이 생성한 값을 응답에 직접 얹는다.
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
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT FN_IS_SUPER_ADMIN(i_user_id) AND NOT FN_CHECK_PROJECT_ACCESS(i_user_id, i_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `project`
        SET
            `api_secret_prev`   = `api_secret`,
            `api_secret`        = i_new_api_secret_enc,
            `secret_rotated_at` = NOW()
        WHERE `project_id` = i_project_id;

        SELECT 0 AS RESULT;
        SELECT `project_id`, `secret_rotated_at`
        FROM `project`
        WHERE `project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;
