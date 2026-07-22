DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_USAGE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_USAGE_LIST` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_game_user_id       VARCHAR(100),     -- 특정 유저 필터 (NULL이면 전체)
    IN i_confirmed          TINYINT UNSIGNED, -- 0=미컨슘만/1=컨펌완료만 (NULL이면 전체)
    IN i_page_size          INT,              -- 페이지당 행 수
    IN i_offset             INT,              -- 시작 오프셋
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인별 쿠폰 사용 이력 조회 - 페이지네이션 (17_CAMPAIGN_API.md 4.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_USAGE_LIST
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001) 순으로
    --        처리한다. 조회 전용이라 approval_status와 무관하게 캠페인 접근 권한만 있으면 볼 수
    --        있다(SP_CAMPAIGN_CODE_LIST와 동일한 권한 범위, 1.3에 따라 status=4 종료 캠페인도
    --        차단 안 됨 - 이 SP는 status를 아예 조건에 넣지 않는다). total_count는 SP_CAMPAIGN_LIST/
    --        SP_CAMPAIGN_CODE_LIST와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 + LEFT JOIN
    --        ... ON TRUE 패턴(02_DEV_CONVENTIONS.md 3.6). code_value는 coupon_code_usage에
    --        비정규화돼 있지 않아(project_id만 비정규화됨, coupon_code_usage.sql 참고)
    --        coupon_code를 조인해서 가져온다. 정렬은 최근 이력이 먼저 보이도록 created_at DESC로
    --        고정한다(SP_LOG_AUDIT_LIST와 동일한 원칙 - 로그성 조회는 최신순).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id
        ) THEN
            SELECT 31004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `project_id` INTO v_project_id
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_PROJECT_ACCESS(i_requester_user_id, v_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            pg.`coupon_code_usage_id`, pg.`code_value`, pg.`game_user_id`,
            pg.`confirmed_at`, pg.`created_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `coupon_code_usage`
            WHERE `coupon_campaign_id` = i_coupon_campaign_id
              AND (i_game_user_id IS NULL OR `game_user_id` = i_game_user_id)
              AND (
                    i_confirmed IS NULL
                    OR (i_confirmed = 1 AND `confirmed_at` IS NOT NULL)
                    OR (i_confirmed = 0 AND `confirmed_at` IS NULL)
                  )
        ) cnt
        LEFT JOIN (
            SELECT u.`coupon_code_usage_id`, c.`code_value`, u.`game_user_id`,
                   u.`confirmed_at`, u.`created_at`
            FROM `coupon_code_usage` u
            JOIN `coupon_code` c ON c.`coupon_code_id` = u.`coupon_code_id`
            WHERE u.`coupon_campaign_id` = i_coupon_campaign_id
              AND (i_game_user_id IS NULL OR u.`game_user_id` = i_game_user_id)
              AND (
                    i_confirmed IS NULL
                    OR (i_confirmed = 1 AND u.`confirmed_at` IS NOT NULL)
                    OR (i_confirmed = 0 AND u.`confirmed_at` IS NULL)
                  )
            ORDER BY u.`created_at` DESC
            LIMIT i_page_size OFFSET i_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;
