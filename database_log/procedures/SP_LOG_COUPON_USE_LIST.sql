DROP PROCEDURE IF EXISTS `SP_LOG_COUPON_USE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_COUPON_USE_LIST` (
    IN i_project_id         BIGINT UNSIGNED,   -- 필수 - 스코핑 기준(17_CAMPAIGN_API.md 4.3, 회사 단위 조회 예외 없음)
    IN i_coupon_campaign_id BIGINT UNSIGNED,   -- 선택 - 특정 캠페인으로 좁힘(NULL이면 프로젝트 전체, 코드 자체가 없는 시도(campaign_id NULL 행) 포함)
    IN i_game_user_id       VARCHAR(100),      -- 선택 필터
    IN i_code_value         VARCHAR(50),       -- 선택 필터
    IN i_action             TINYINT UNSIGNED,  -- 선택 필터 (10:RESERVE, 20:CONFIRM)
    IN i_result_type        TINYINT UNSIGNED,  -- 선택 필터 (04_DATABASE_SCHEMA.md 11장)
    IN i_from_created_at    DATETIME,          -- 조회 시작일시(NULL이면 하한 없음)
    IN i_to_created_at      DATETIME,          -- 조회 종료일시(NULL이면 상한 없음)
    IN i_page_size          INT,               -- 페이지당 행 수
    IN i_offset             INT                -- 시작 오프셋
) COMMENT '쿠폰 사용 시도 로그 목록 조회 - project_id 필수, 페이지네이션 (17_CAMPAIGN_API.md 4.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_COUPON_USE_LIST
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : log_coupon_use를 project_id로 필터링해 created_at DESC로 정렬 후 페이지 단위로
    --        반환한다. 이 SP는 로그 DB(coupon_platform_log)에서 실행되며 메인 DB의
    --        coupon_campaign/user/user_role 테이블에 접근할 수 없다(02_DEV_CONVENTIONS.md 1장,
    --        물리 분리) - SP_LOG_AUDIT_LIST/SP_LOG_COUPON_CAMPAIGN_LIST와 동일한 구조적 제약으로
    --        이 SP는 권한 재검증을 하지 않는다(02_DEV_CONVENTIONS.md 3.2 예외). project_id
    --        접근권한 확인은 앱(TS) 레이어가 이 SP 호출 전에 신규 SP_PROJECT_CHECK_ACCESS(메인 DB)
    --        로 먼저 수행한다 - "메인 DB 접근권한 확인 → 로그 DB 목록 조회" 2단계 패턴
    --        (02_DEV_CONVENTIONS.md 3.2). log_coupon_campaign(4.2)과 달리 이 로그는 project_id에
    --        종속되고 coupon_campaign_id에는 종속되지 않는다(NULL 허용 - 코드 자체가 존재하지
    --        않는 시도는 캠페인을 특정할 수 없음, 04_DATABASE_SCHEMA.md 11장) - 그래서 접근권한
    --        확인 대상이 "특정 캠페인"이 아니라 "프로젝트"이고, 전용 체크 SP가 별도로 필요했다
    --        (SP_CAMPAIGN_LIST처럼 FN_CHECK_PROJECT_ACCESS를 SP 안에서 바로 쓸 수 있는 건
    --        coupon_campaign이 메인 DB에 있어서 가능한 것 - 이 SP는 그 전제가 성립하지 않는다).
    --        total_count는 다른 목록 SP와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 +
    --        LEFT JOIN ... ON TRUE 패턴으로 반환한다.
    --        정렬은 SP_LOG_AUDIT_LIST/SP_LOG_COUPON_CAMPAIGN_LIST와 동일하게 `created_at DESC,
    --        idx DESC` 2단 키다(같은 초 안에 여러 시도가 겹치는 경우 순서 보장 목적).
    --        campaign_name(응답에 필요, 17_CAMPAIGN_API.md 4.3)은 이 SP가 채우지 않는다 - 메인
    --        DB(coupon_campaign)와 물리 분리라 조인이 불가능해, coupon_campaign_id가 있는 행만
    --        앱(TS) 레이어가 메인 DB에서 배치 조회해 응답 조립 시 붙인다.
    -- 수정1: 2026.07.23 trisakion — log_coupon_use.caller_ip 추가에 맞춰 응답에 caller_ip를
    --        포함한다. 이 로그를 사람이 들여다보는 유일한 창구가 4.3이라, 저장만 하고 조회
    --        API에서 빠뜨리면 사실상 못 쓰는 컬럼이 되므로 함께 반영.
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
        lu.`idx`, lu.`action`, lu.`project_id`, lu.`coupon_campaign_id`, lu.`code_value`,
        lu.`game_user_id`, lu.`result_type`, lu.`caller_ip`, lu.`created_at`,
        cnt.`total_count`
    FROM (
        SELECT COUNT(*) AS total_count
        FROM `log_coupon_use`
        WHERE `project_id` = i_project_id
          AND (i_coupon_campaign_id IS NULL OR `coupon_campaign_id` = i_coupon_campaign_id)
          AND (i_game_user_id IS NULL OR `game_user_id` = i_game_user_id)
          AND (i_code_value IS NULL OR `code_value` = i_code_value)
          AND (i_action IS NULL OR `action` = i_action)
          AND (i_result_type IS NULL OR `result_type` = i_result_type)
          AND (i_from_created_at IS NULL OR `created_at` >= i_from_created_at)
          AND (i_to_created_at IS NULL OR `created_at` <= i_to_created_at)
    ) cnt
    LEFT JOIN (
        SELECT `idx`, `action`, `project_id`, `coupon_campaign_id`, `code_value`,
               `game_user_id`, `result_type`, `caller_ip`, `created_at`
        FROM `log_coupon_use`
        WHERE `project_id` = i_project_id
          AND (i_coupon_campaign_id IS NULL OR `coupon_campaign_id` = i_coupon_campaign_id)
          AND (i_game_user_id IS NULL OR `game_user_id` = i_game_user_id)
          AND (i_code_value IS NULL OR `code_value` = i_code_value)
          AND (i_action IS NULL OR `action` = i_action)
          AND (i_result_type IS NULL OR `result_type` = i_result_type)
          AND (i_from_created_at IS NULL OR `created_at` >= i_from_created_at)
          AND (i_to_created_at IS NULL OR `created_at` <= i_to_created_at)
        ORDER BY `created_at` DESC, `idx` DESC
        LIMIT i_page_size OFFSET i_offset
    ) lu ON TRUE;
END$$

DELIMITER ;
