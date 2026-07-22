DROP PROCEDURE IF EXISTS `SP_LOG_AUDIT_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_AUDIT_LIST` (
    IN i_company_id      BIGINT UNSIGNED,   -- 회사 필터(NULL이면 전체) - DEVELOPER 호출 시 앱 레이어가 자기 회사로 강제
    IN i_project_id      BIGINT UNSIGNED,   -- 프로젝트 필터(NULL이면 전체)
    IN i_table_name      VARCHAR(100),      -- 대상 테이블명 필터(NULL이면 전체)
    IN i_target_id       VARCHAR(100),      -- 대상 식별자 필터(NULL이면 전체)
    IN i_action          TINYINT UNSIGNED,  -- 작업유형 필터(NULL이면 전체)
    IN i_from_created_at DATETIME,          -- 조회 시작일시(NULL이면 하한 없음)
    IN i_to_created_at   DATETIME,          -- 조회 종료일시(NULL이면 상한 없음)
    IN i_page_size       INT,               -- 페이지당 행 수
    IN i_offset          INT                -- 시작 오프셋
) COMMENT '감사 로그 목록 조회 - 페이지네이션 (13_LOG_AUDIT_API.md 5장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_AUDIT_LIST
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : log_audit를 created_at DESC로 정렬해 페이지 단위로 반환한다(13_LOG_AUDIT_API.md 5장
    --        Sorting). 이 SP는 로그 DB(coupon_platform_log)에서 실행되며 메인 DB의 user/user_role
    --        테이블에 접근할 수 없다(02_DEV_CONVENTIONS.md 1장, 물리 분리) - 그래서 이 프로젝트의
    --        일반 원칙("SP가 FN_IS_SUPER_ADMIN 등으로 호출자 권한을 스스로 재검증")을 여기서는
    --        적용할 수 없다. 권한 판단(SUPER_ADMIN 전체조회/DEVELOPER는 본인 소속 company_id로
    --        고정 스코핑, 13_LOG_AUDIT_API.md 3장)은 전부 앱 레이어(LogAuditService)가 담당하고,
    --        i_company_id는 이미 스코핑이 끝난 값을 그대로 받는다 - SP_LOG_AUDIT_CREATE가 같은
    --        이유(로그 DB는 인프라 호출 전용, 메인 SP가 권한 검증을 이미 끝낸 뒤 호출)로 권한
    --        검증 자체를 아예 두지 않는 것과 같은 물리적 제약이다.
    --        total_count는 다른 목록 SP(SP_PROJECT_LIST 등)와 동일하게 COUNT(*) OVER()가 아니라
    --        별도 서브쿼리 + LEFT JOIN ... ON TRUE 패턴으로 반환한다(offset이 범위를 벗어나 0행이
    --        반환돼도 total_count가 0으로 사라지지 않도록).
    --        정렬은 `created_at DESC, idx DESC` 2단 키다 - `created_at`이 초 단위 정밀도(DATETIME,
    --        마이크로초 없음)라 같은 초 안에 두 로그가 생성되면(예: CREATE 직후 곧바로 UPDATE)
    --        `created_at`만으로는 동순위가 되어 MySQL이 삽입 순서를 보장해주지 않는다 - 실제로
    --        스모크 테스트에서 CREATE가 UPDATE보다 나중에 나오는(최신순이 아닌) 경우가 재현됨
    --        (2026-07-22). `idx`는 AUTO_INCREMENT라 생성 순서와 완전히 동일하므로 2차 키로 쓰면
    --        타이밍에 의존하지 않고 항상 정확한 최신순이 보장된다.
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

    SELECT 0 AS RESULT;
    SELECT
        lg.`idx`, lg.`company_id`, lg.`project_id`, lg.`table_name`, lg.`target_id`,
        lg.`target_name`, lg.`action`, lg.`created_by`, lg.`created_by_name`, lg.`created_at`,
        cnt.`total_count`
    FROM (
        SELECT COUNT(*) AS total_count
        FROM `log_audit`
        WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
          AND (i_project_id IS NULL OR `project_id` = i_project_id)
          AND (i_table_name IS NULL OR `table_name` = i_table_name)
          AND (i_target_id IS NULL OR `target_id` = i_target_id)
          AND (i_action IS NULL OR `action` = i_action)
          AND (i_from_created_at IS NULL OR `created_at` >= i_from_created_at)
          AND (i_to_created_at IS NULL OR `created_at` <= i_to_created_at)
    ) cnt
    LEFT JOIN (
        SELECT `idx`, `company_id`, `project_id`, `table_name`, `target_id`,
               `target_name`, `action`, `created_by`, `created_by_name`, `created_at`
        FROM `log_audit`
        WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
          AND (i_project_id IS NULL OR `project_id` = i_project_id)
          AND (i_table_name IS NULL OR `table_name` = i_table_name)
          AND (i_target_id IS NULL OR `target_id` = i_target_id)
          AND (i_action IS NULL OR `action` = i_action)
          AND (i_from_created_at IS NULL OR `created_at` >= i_from_created_at)
          AND (i_to_created_at IS NULL OR `created_at` <= i_to_created_at)
        ORDER BY `created_at` DESC, `idx` DESC
        LIMIT i_page_size OFFSET i_offset
    ) lg ON TRUE;
END$$

DELIMITER ;
