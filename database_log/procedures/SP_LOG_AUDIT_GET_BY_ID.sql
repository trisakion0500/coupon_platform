DROP PROCEDURE IF EXISTS `SP_LOG_AUDIT_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_AUDIT_GET_BY_ID` (
    IN i_idx BIGINT UNSIGNED   -- 조회할 감사 로그 ID
) COMMENT '감사 로그 상세 조회 (13_LOG_AUDIT_API.md 6장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_AUDIT_GET_BY_ID
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : idx 단건 조회, 존재하지 않으면 31008(신규 result 코드, 08_API_COMMON.md 동기화).
    --        SP_LOG_AUDIT_LIST와 동일한 이유로 이 SP 자체는 호출자 권한을 재검증하지 않는다
    --        (로그 DB가 메인 DB의 user/user_role에 물리적으로 접근 불가) - 앱 레이어
    --        (LogAuditService)가 SUPER_ADMIN이 아니면 조회된 행의 company_id가 호출자 소속과
    --        일치하는지 확인해 불일치 시 20001로 거부한다. ProjectService.getById가 SP의
    --        FN_CHECK_COMPANY_ACCESS 재검증에 더해 앱 레이어에서도 같은 판단을 한 번 더 하는
    --        "방어적 이중 체크" 위치와 동일하지만, 여기서는 SP 쪽 재검증이 물리적으로 불가능해
    --        앱 레이어가 유일한 방어선이라는 점이 다르다.
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
        IF NOT EXISTS (SELECT 1 FROM `log_audit` WHERE `idx` = i_idx) THEN
            SELECT 31008 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `idx`, `company_id`, `project_id`, `table_name`, `target_id`, `target_name`,
            `action`, `before_json`, `after_json`, `created_by`, `created_by_name`, `created_at`
        FROM `log_audit`
        WHERE `idx` = i_idx;
    END proc_block;
END$$

DELIMITER ;
