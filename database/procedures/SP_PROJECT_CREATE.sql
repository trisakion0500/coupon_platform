DROP PROCEDURE IF EXISTS `SP_PROJECT_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_CREATE` (
    IN i_company_id        BIGINT UNSIGNED,  -- 소속 회사 ID
    IN i_project_code      VARCHAR(20),      -- 프로젝트 코드 (company_id 범위 내 UNIQUE)
    IN i_project_name      VARCHAR(100),     -- 프로젝트명
    IN i_description       VARCHAR(1000),    -- 설명 (선택)
    IN i_api_key           VARCHAR(64),      -- 서버간 호출용 API Key (앱 레이어에서 생성)
    IN i_api_secret_enc    VARCHAR(255),     -- API Secret AES-256-CBC 암호화값 (앱 레이어에서 암호화 완료)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 생성 - SUPER_ADMIN 재검증, api_key/api_secret 발급 후 INSERT (13_PROJECT_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 생성. company_id 존재(31001) 확인 후 company_id 범위 내 project_code
    --        중복(32001)을 사전 체크한 뒤 INSERT한다. api_key/api_secret은 이미 앱 레이어
    --        (ProjectService)에서 생성/암호화가 끝난 값을 그대로 저장한다 — SP는 암호화 로직을
    --        모른다(SP_USER_SIGNUP과 동일한 원칙). 사전 체크는 원자적이지 않으므로 INSERT의
    --        UNIQUE 제약 위반(1062, project_code 또는 api_key 어느 쪽이든)도 32001로 통일해
    --        백스톱한다 — api_key는 256비트 난수라 충돌 가능성이 사실상 0에 가까워 별도 코드로
    --        구분하지 않는다.
    --        반환 컬럼에 api_secret(암호문)은 포함하지 않는다 — 앱으로 다시 내보낼 이유가 없고,
    --        평문은 서비스 레이어가 자신이 생성한 값을 응답에 직접 얹는다.
    --        프로젝트 생성은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        04_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 결과 SELECT에 after_json/requester_name을
    --        추가했다(before_json은 CREATE라 NULL). after_json 안의 api_secret/api_secret_prev는
    --        암호문이라도 ENCRYPTION_KEY 유출 시 복호화가 가능해 password_hash와 동일 수준으로
    --        '***' 마스킹한다(15_LOG_AUDIT_API.md 2.4).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT       DEFAULT NULL;

    -- project_code/api_key 유니크 제약 위반(경쟁 상태 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

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

        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (
            SELECT 1 FROM `project`
            WHERE `company_id` = i_company_id AND `project_code` = i_project_code
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `project` (
            `company_id`, `project_code`, `project_name`, `description`, `api_key`, `api_secret`
        ) VALUES (
            i_company_id, i_project_code, i_project_name, i_description, i_api_key, i_api_secret_enc
        );

        SET v_project_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `project_id`, `company_id`, `project_code`, `project_name`, `description`,
            `api_key`, `status`, `created_at`, `updated_at`, `edit_count`,
            JSON_OBJECT(                    -- after_json: log_audit 스냅샷(api_secret류 마스킹)
                'project_id', `project_id`, 'company_id', `company_id`,
                'project_code', `project_code`, 'project_name', `project_name`,
                'description', `description`, 'api_key', `api_key`,
                'api_secret', '***',
                'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
                'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `project`
        WHERE `project_id` = v_project_id;
    END proc_block;
END$$

DELIMITER ;
