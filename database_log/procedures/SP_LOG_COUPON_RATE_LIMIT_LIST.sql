DROP PROCEDURE IF EXISTS `SP_LOG_COUPON_RATE_LIMIT_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_COUPON_RATE_LIMIT_LIST` (
    IN i_company_id      BIGINT UNSIGNED,   -- 회사 필터(NULL이면 전체) - DEVELOPER 호출 시 앱 레이어가 자기 회사로 강제
    IN i_project_id      BIGINT UNSIGNED,   -- 프로젝트 필터(NULL이면 전체)
    IN i_limit_scope     TINYINT UNSIGNED,  -- 리밋 종류 필터(NULL이면 전체, 10:PROJECT/20:USER)
    IN i_action          TINYINT UNSIGNED,  -- 작업유형 필터(NULL이면 전체, 10:RESERVE/20:CONFIRM)
    IN i_game_user_id    VARCHAR(100),      -- 게임 유저 ID 필터(NULL이면 전체)
    IN i_from_created_at DATETIME,          -- 조회 시작일시(NULL이면 하한 없음)
    IN i_to_created_at   DATETIME,          -- 조회 종료일시(NULL이면 상한 없음)
    IN i_page_size       INT,               -- 페이지당 행 수
    IN i_offset          INT,               -- 시작 오프셋
    IN i_developer_project_ids VARCHAR(4000) -- DEVELOPER의 배정 프로젝트 추가 스코핑용 콤마 목록(NULL=제한없음, SUPER_ADMIN 전용)
) COMMENT '레이트리밋 초과 로그 목록 조회 - 페이지네이션'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_COUPON_RATE_LIMIT_LIST
    -- 작성 : 2026.08.06 trisakion
    -- 내용 : log_coupon_rate_limit를 created_at DESC로 정렬해 페이지 단위로 반환한다. 이 SP는
    --        로그 DB(coupon_platform_log)에서 실행되며 메인 DB의 user/user_role 테이블에 접근할
    --        수 없다(04_DEV_CONVENTIONS.md 1장, 물리 분리) - SP_LOG_AUDIT_LIST와 동일한 이유로
    --        이 SP 자체는 호출자 권한을 재검증하지 않는다. 권한 판단(SUPER_ADMIN 전체조회/
    --        DEVELOPER는 본인 소속 company_id + 역할보유(role_code<=20) 배정 프로젝트로 스코핑,
    --        16_MENU_PERMISSION.md 2.6)은 전부 앱 레이어(LogRateLimitService)가 담당한다.
    --        i_developer_project_ids는 SP_LOG_AUDIT_LIST와 달리 table_name 예외 조건이 없다 -
    --        log_coupon_rate_limit의 모든 행이 개념적으로 프로젝트 단위 이벤트(company/user
    --        테이블처럼 프로젝트와 무관한 행 자체가 없음)라 i_developer_project_ids가 NULL이
    --        아니면(=DEVELOPER 호출) 항상 FIND_IN_SET 조건을 적용한다. project_id가 NULL인
    --        행(identity 미해석 - project-identity-cache.service.ts 참고)은 FIND_IN_SET이
    --        자연히 NULL(거짓)을 반환해 DEVELOPER에게는 항상 제외되고 SUPER_ADMIN만 볼 수 있다.
    --        total_count는 다른 목록 SP와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 +
    --        LEFT JOIN ... ON TRUE 패턴으로 반환한다(offset이 범위를 벗어나 0행이 반환돼도
    --        total_count가 0으로 사라지지 않도록). 정렬은 SP_LOG_AUDIT_LIST와 동일하게
    --        `created_at DESC, idx DESC` 2단 키다(created_at이 초 단위 정밀도라 같은 초 안에
    --        여러 로그가 생성되면 idx로 생성 순서를 보정).
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
        rl.`idx`, rl.`limit_scope`, rl.`action`, rl.`api_key`, rl.`project_id`, rl.`company_id`,
        rl.`game_user_id`, rl.`retry_after_sec`, rl.`caller_ip`, rl.`created_at`,
        cnt.`total_count`
    FROM (
        SELECT COUNT(*) AS total_count
        FROM `log_coupon_rate_limit`
        WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
          AND (i_project_id IS NULL OR `project_id` = i_project_id)
          AND (i_limit_scope IS NULL OR `limit_scope` = i_limit_scope)
          AND (i_action IS NULL OR `action` = i_action)
          AND (i_game_user_id IS NULL OR `game_user_id` = i_game_user_id)
          AND (i_from_created_at IS NULL OR `created_at` >= i_from_created_at)
          AND (i_to_created_at IS NULL OR `created_at` <= i_to_created_at)
          AND (i_developer_project_ids IS NULL OR FIND_IN_SET(`project_id`, i_developer_project_ids) > 0)
    ) cnt
    LEFT JOIN (
        SELECT `idx`, `limit_scope`, `action`, `api_key`, `project_id`, `company_id`,
               `game_user_id`, `retry_after_sec`, `caller_ip`, `created_at`
        FROM `log_coupon_rate_limit`
        WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
          AND (i_project_id IS NULL OR `project_id` = i_project_id)
          AND (i_limit_scope IS NULL OR `limit_scope` = i_limit_scope)
          AND (i_action IS NULL OR `action` = i_action)
          AND (i_game_user_id IS NULL OR `game_user_id` = i_game_user_id)
          AND (i_from_created_at IS NULL OR `created_at` >= i_from_created_at)
          AND (i_to_created_at IS NULL OR `created_at` <= i_to_created_at)
          AND (i_developer_project_ids IS NULL OR FIND_IN_SET(`project_id`, i_developer_project_ids) > 0)
        ORDER BY `created_at` DESC, `idx` DESC
        LIMIT i_page_size OFFSET i_offset
    ) rl ON TRUE;
END$$

DELIMITER ;
