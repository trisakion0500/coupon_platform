DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_LIST` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_status             TINYINT UNSIGNED, -- 상태 필터 (NULL이면 전체)
    IN i_page_size          INT,              -- 페이지당 행 수
    IN i_offset             INT,              -- 시작 오프셋
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인별 쿠폰 코드 목록 조회 - 페이지네이션 (19_CAMPAIGN_API.md 3.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_LIST
    -- 작성 : 2026.07.21 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001) 순으로
    --        처리한다. 조회 전용이라 approval_status/generation_status와 무관하게 캠페인 접근
    --        권한만 있으면 볼 수 있다(SP_CAMPAIGN_GET_BY_ID와 동일한 권한 범위). total_count는
    --        SP_CAMPAIGN_LIST와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 + LEFT JOIN ...
    --        ON TRUE 패턴(04_DEV_CONVENTIONS.md 3.6). FIXED는 항상 최대 1건이라 정렬 기준이 중요치
    --        않지만, RANDOM 대량조회 편의를 위해 coupon_code_id 오름차순(생성순)으로 고정한다.
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
            pg.`coupon_code_id`, pg.`code_value`, pg.`status`, pg.`created_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `coupon_code`
            WHERE `coupon_campaign_id` = i_coupon_campaign_id
              AND (i_status IS NULL OR `status` = i_status)
        ) cnt
        LEFT JOIN (
            SELECT `coupon_code_id`, `code_value`, `status`, `created_at`
            FROM `coupon_code`
            WHERE `coupon_campaign_id` = i_coupon_campaign_id
              AND (i_status IS NULL OR `status` = i_status)
            ORDER BY `coupon_code_id` ASC
            LIMIT i_page_size OFFSET i_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;
