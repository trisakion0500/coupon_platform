DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_API_KEY`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_API_KEY` (
    IN i_api_key VARCHAR(64)  -- 조회할 API Key (project.api_key)
) COMMENT 'API Key로 project 조회 (S2S 인증 가드 전용, docs/07_AUTH_SECURITY.md 2.4 3~4번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_API_KEY
    -- 작성 : 2026.07.19 trisakion
    -- 수정1: 2026.07.27 trisakion — company_code/project_code 추가 반환. S2S 실패 운영 로그
    --        (S2sFailureLogger, coupon-usage.service.ts)가 "[company_code][project_code] ..."
    --        형식으로 남기려면 이 값들이 필요한데, S2sAuthGuard가 매 요청마다 이미 이 SP를
    --        호출하고 있어 별도 추가 조회 없이 이 SP 결과에 얹어서 공짜로 얻는다.
    -- 내용 : S2S 인증 가드(docs/07_AUTH_SECURITY.md 2.4 3~4번)가 X-API-Key로 project를 조회할 때 사용.
    --        RESULT SELECT 규약(docs/02_DEV_CONVENTIONS.md 3.4)을 따른다 — 첫 SELECT는 RESULT 단일 행,
    --        성공(0)일 때만 두 번째 SELECT로 project 행(암호화된 api_secret/api_secret_prev 포함)을 반환한다.
    --        프로젝트 상태(status=0 중지)는 이 SP에서 판단하지 않는다 — "코드 없음(31002)"과
    --        "상태 불가(10014)"는 서로 다른 result 코드라, 조회 자체는 그대로 성공시키고 상태 확인은
    --        가드 쪽에서 조회된 값을 보고 별도로 매핑한다.
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
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `api_key` = i_api_key) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`project_id`,
            p.`status`,
            p.`api_secret`,
            p.`api_secret_prev`,
            p.`secret_rotated_at`,
            p.`project_code`,
            c.`company_code`
        FROM `project` p
        JOIN `company` c ON c.`company_id` = p.`company_id`
        WHERE p.`api_key` = i_api_key;
    END proc_block;
END$$

DELIMITER ;
