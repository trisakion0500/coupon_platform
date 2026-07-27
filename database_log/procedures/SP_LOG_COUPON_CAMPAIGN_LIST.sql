DROP PROCEDURE IF EXISTS `SP_LOG_COUPON_CAMPAIGN_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_LOG_COUPON_CAMPAIGN_LIST` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID (필수 - 이 API는 항상 특정 캠페인에 종속)
    IN i_action             TINYINT UNSIGNED, -- 작업유형 필터(NULL이면 전체, 10:CREATE/20:UPDATE/30:STATUS_CHANGE/40:APPROVE/50:REJECT)
    IN i_page_size          INT,              -- 페이지당 행 수
    IN i_offset             INT               -- 시작 오프셋
) COMMENT '캠페인 변경 이력 목록 조회 - coupon_campaign_id 필수, 페이지네이션 (19_CAMPAIGN_API.md 4.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOG_COUPON_CAMPAIGN_LIST
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : log_coupon_campaign을 coupon_campaign_id로 필터링해 created_at DESC로 정렬 후 페이지
    --        단위로 반환한다. 이 SP는 로그 DB(coupon_platform_log)에서 실행되며 메인 DB의
    --        coupon_campaign/user/user_role 테이블에 접근할 수 없다(04_DEV_CONVENTIONS.md 1장,
    --        물리 분리) - 그래서 이 프로젝트의 일반 원칙("SP가 FN_CHECK_PROJECT_ACCESS 등으로
    --        호출자 권한을 스스로 재검증")을 여기서는 적용할 수 없다(SP_LOG_AUDIT_LIST와 동일한
    --        구조적 제약, 04_DEV_CONVENTIONS.md 3.2 예외 참고). 캠페인 존재확인(31004)+프로젝트
    --        스코핑(20001) 재검증은 앱(TS) 레이어가 이 SP 호출 전에 메인 DB에서 먼저 수행한다
    --        (CampaignService가 이미 갖고 있는 존재확인+스코핑 체크 재사용, SP_CAMPAIGN_GET_BY_ID와
    --        동일 로직) - "메인 DB 접근권한 확인 → 로그 DB 목록 조회" 2단계 패턴
    --        (04_DEV_CONVENTIONS.md 3.2 신규 예외 항목 참고).
    --        total_count는 다른 목록 SP와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 +
    --        LEFT JOIN ... ON TRUE 패턴으로 반환한다(offset이 범위를 벗어나 0행이 반환돼도
    --        total_count가 0으로 사라지지 않도록).
    --        정렬은 SP_LOG_AUDIT_LIST와 동일하게 `created_at DESC, idx DESC` 2단 키다 - created_at
    --        (DATETIME, 마이크로초 없음)만으로는 같은 초 안에 여러 액션이 겹칠 때 순서가 보장되지
    --        않는다(2026-07-22 SP_LOG_AUDIT_LIST에서 실제 재현된 문제, 동일 원인이라 처음부터
    --        2단 키로 작성).
    --        응답 컬럼은 log_coupon_campaign 전체(coupon_campaign 컬럼 스냅샷 + action +
    --        created_by/created_by_name/created_at) 그대로다 - before/after 비교(diff)는 이 SP가
    --        하지 않고 프론트엔드가 인접한 두 행을 비교해 표시한다(19_CAMPAIGN_API.md 4.2).
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
        lc.`idx`, lc.`action`, lc.`coupon_campaign_id`, lc.`project_id`, lc.`name`,
        lc.`campaign_start`, lc.`campaign_end`, lc.`code_type`, lc.`use_hyphen`,
        lc.`requested_qty`, lc.`generated_qty`, lc.`usable_qty`, lc.`used_qty`,
        lc.`use_limit_per_user`, lc.`status`, lc.`approval_status`, lc.`approved_by`,
        lc.`approved_at`, lc.`reject_reason`, lc.`reward_data`, lc.`created_by`,
        lc.`created_by_name`, lc.`created_at`,
        cnt.`total_count`
    FROM (
        SELECT COUNT(*) AS total_count
        FROM `log_coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND (i_action IS NULL OR `action` = i_action)
    ) cnt
    LEFT JOIN (
        SELECT
            `idx`, `action`, `coupon_campaign_id`, `project_id`, `name`, `campaign_start`,
            `campaign_end`, `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`,
            `usable_qty`, `used_qty`, `use_limit_per_user`, `status`, `approval_status`,
            `approved_by`, `approved_at`, `reject_reason`, `reward_data`, `created_by`,
            `created_by_name`, `created_at`
        FROM `log_coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND (i_action IS NULL OR `action` = i_action)
        ORDER BY `created_at` DESC, `idx` DESC
        LIMIT i_page_size OFFSET i_offset
    ) lc ON TRUE;
END$$

DELIMITER ;
