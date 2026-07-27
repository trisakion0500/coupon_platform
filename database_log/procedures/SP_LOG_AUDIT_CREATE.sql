DROP PROCEDURE IF EXISTS `SP_LOG_AUDIT_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_AUDIT_CREATE` (
    IN i_action          TINYINT UNSIGNED,  -- 작업유형 (10:CREATE, 20:UPDATE, 30:STATUS_CHANGE)
    IN i_company_id      BIGINT UNSIGNED,   -- 회사 ID (스코핑용, FK 없음)
    IN i_project_id      BIGINT UNSIGNED,   -- 프로젝트 ID (company/user 대상이면 NULL)
    IN i_table_name      VARCHAR(100),      -- 대상 테이블명 (company/project/user/user_role)
    IN i_target_id       VARCHAR(100),      -- 대상 PK 값(단일 PK) 또는 복합 PK JSON 문자열(user_role)
    IN i_target_name     VARCHAR(200),      -- 대상 표시명 스냅샷
    IN i_before_json     LONGTEXT,          -- 변경 전 전체 Row JSON (CREATE는 NULL)
    IN i_after_json      LONGTEXT,          -- 변경 후 전체 Row JSON
    IN i_created_by      BIGINT UNSIGNED,   -- 작업 수행자 user_id
    IN i_created_by_name VARCHAR(50)        -- 작업 수행자명 스냅샷
) COMMENT '감사 로그 적재 (Append-Only, 15_LOG_AUDIT_API.md 2장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_AUDIT_CREATE
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : log_audit 단순 INSERT. 이 SP는 로그 DB(coupon_platform_log)에서만 실행되며,
    --        메인 DB(coupon_platform)와 물리적으로 분리돼 있어 메인 SP가 직접 호출할 수 없다
    --        (04_DEV_CONVENTIONS.md 1장) — 그래서 before_json/after_json/requester_name은
    --        메인 도메인 SP(SP_COMPANY_UPDATE 등)가 이미 계산해 반환한 값을 TS
    --        (LogSpExecutorService.logCall)가 그대로 전달하기만 한다. 권한 검증이 없다 —
    --        외부(HTTP)에 직접 노출되지 않는 백엔드 내부 인프라 호출 전용이고, 호출 시점엔
    --        이미 메인 도메인 SP의 권한 검증(FN_IS_SUPER_ADMIN 등)이 끝난 뒤이기 때문이다.
    --        로그 적재 실패가 메인 트랜잭션에 영향을 주면 안 되므로(LogSpExecutorService.logCall이
    --        예외를 잡아 삼킨다) 이 SP 자체는 RESULT=0/50001만 있으면 충분하고, 데이터 반환용
    --        두 번째 SELECT는 필요 없다(호출부가 반환값을 쓰지 않음).
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

    INSERT INTO `log_audit` (
        `action`, `company_id`, `project_id`, `table_name`, `target_id`, `target_name`,
        `before_json`, `after_json`, `created_by`, `created_by_name`
    ) VALUES (
        i_action, i_company_id, i_project_id, i_table_name, i_target_id, i_target_name,
        i_before_json, i_after_json, i_created_by, i_created_by_name
    );

    SELECT 0 AS RESULT;
END$$

DELIMITER ;
