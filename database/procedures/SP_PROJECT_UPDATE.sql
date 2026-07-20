DROP PROCEDURE IF EXISTS `SP_PROJECT_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_UPDATE` (
    IN i_project_id        BIGINT UNSIGNED,  -- 수정할 프로젝트 ID
    IN i_project_name      VARCHAR(100),     -- 새 프로젝트명 (NULL이면 미변경)
    IN i_description       VARCHAR(1000),    -- 새 설명 (NULL이면 미변경)
    IN i_status            TINYINT UNSIGNED, -- 새 상태 (NULL이면 미변경)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 수정 - SUPER_ADMIN 재검증, 조건부 UPDATE (11_PROJECT_API.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 정보 수정. company_id/project_code/api_key/api_secret은 이 SP의 파라미터에
    --        아예 없다 — 생성 후 변경 불가 필드라 애초에 받지 않는다(11_PROJECT_API.md 2.4
    --        Non-Updatable Fields). 존재 확인(31002) -> COALESCE 기반 조건부 UPDATE
    --        (02_DEV_CONVENTIONS.md 4장)로 NULL로 넘어온 필드는 기존 값을 유지한다.
    --        프로젝트 수정은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다.
    --        api_secret/api_secret_prev는 이 SP가 건드리지 않는 필드지만 "전체 Row" 스냅샷
    --        원칙(13_LOG_AUDIT_API.md 2.3)상 JSON에 포함하고 '***'로 마스킹한다.
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

        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷(api_secret류 마스킹)
            'project_id', `project_id`, 'company_id', `company_id`,
            'project_code', `project_code`, 'project_name', `project_name`,
            'description', `description`, 'api_key', `api_key`,
            'api_secret', '***',
            'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
            'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `project` WHERE `project_id` = i_project_id;

        UPDATE `project`
        SET
            `project_name` = COALESCE(i_project_name, `project_name`),
            `description`  = COALESCE(i_description, `description`),
            `status`       = COALESCE(i_status, `status`)
        WHERE `project_id` = i_project_id;

        SELECT 0 AS RESULT;
        SELECT
            p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
            p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
            p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'project_id', p.`project_id`, 'company_id', p.`company_id`,
                'project_code', p.`project_code`, 'project_name', p.`project_name`,
                'description', p.`description`, 'api_key', p.`api_key`,
                'api_secret', '***',
                'api_secret_prev', IF(p.`api_secret_prev` IS NULL, NULL, '***'),
                'secret_rotated_at', p.`secret_rotated_at`, 'status', p.`status`,
                'created_at', p.`created_at`, 'updated_at', p.`updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `project` p
        JOIN `company` c ON c.`company_id` = p.`company_id`
        WHERE p.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;
