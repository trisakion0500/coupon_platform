DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_LIST` (
    IN i_project_id        BIGINT UNSIGNED,   -- 필수 - 스코핑 기준(17_CAMPAIGN_API.md 2.2, 회사 단위 아님)
    IN i_status            TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_approval_status   TINYINT UNSIGNED,  -- 승인상태 필터 (NULL이면 전체)
    IN i_generation_status TINYINT UNSIGNED,  -- 코드 생성 진행상태 필터 (NULL이면 전체)
    IN i_code_type         TINYINT UNSIGNED,  -- 코드 발급 방식 필터 (NULL이면 전체)
    IN i_page_size         INT,               -- 페이지당 행 수
    IN i_offset            INT,               -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED    -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 목록 조회 - project_id 필수 스코핑, 페이지네이션 (17_CAMPAIGN_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_LIST
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : company/project 도메인의 목록 조회와 달리, 이 도메인은 "회사 전체 조회" 예외가 없고
    --        DEVELOPER/MANAGER/OPERATOR 전부 project_id 단위로만 스코핑한다(17_CAMPAIGN_API.md
    --        1.2). 그래서 i_project_id는 필수이며(company_id처럼 NULL 허용 아님), SUPER_ADMIN
    --        우회 후에는 FN_CHECK_PROJECT_ACCESS로 호출자가 그 프로젝트에 실제 활성 배정이
    --        있는지만 확인하면 된다(role_code 값 자체는 이 SP의 분기에 필요 없음 —
    --        FN_GET_PROJECT_ROLE_CODE가 아니라 FN_CHECK_PROJECT_ACCESS를 쓰는 이유).
    --        total_count는 SP_PROJECT_LIST와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 +
    --        LEFT JOIN ... ON TRUE 패턴으로 반환한다(02_DEV_CONVENTIONS.md 3.6).
    --        정렬은 status DESC, created_at DESC(17_CAMPAIGN_API.md 2.2 Sorting).
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
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_PROJECT_ACCESS(i_requester_user_id, i_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            pg.`coupon_campaign_id`, pg.`project_id`, pg.`name`, pg.`code_type`,
            pg.`requested_qty`, pg.`generated_qty`, pg.`generation_status`,
            pg.`usable_qty`, pg.`used_qty`, pg.`status`, pg.`approval_status`,
            pg.`campaign_start`, pg.`campaign_end`, pg.`created_at`, pg.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `coupon_campaign`
            WHERE `project_id` = i_project_id
              AND (i_status IS NULL OR `status` = i_status)
              AND (i_approval_status IS NULL OR `approval_status` = i_approval_status)
              AND (i_generation_status IS NULL OR `generation_status` = i_generation_status)
              AND (i_code_type IS NULL OR `code_type` = i_code_type)
        ) cnt
        LEFT JOIN (
            SELECT
                `coupon_campaign_id`, `project_id`, `name`, `code_type`,
                `requested_qty`, `generated_qty`, `generation_status`,
                `usable_qty`, `used_qty`, `status`, `approval_status`,
                `campaign_start`, `campaign_end`, `created_at`, `updated_at`
            FROM `coupon_campaign`
            WHERE `project_id` = i_project_id
              AND (i_status IS NULL OR `status` = i_status)
              AND (i_approval_status IS NULL OR `approval_status` = i_approval_status)
              AND (i_generation_status IS NULL OR `generation_status` = i_generation_status)
              AND (i_code_type IS NULL OR `code_type` = i_code_type)
            ORDER BY `status` DESC, `created_at` DESC
            LIMIT i_page_size OFFSET i_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;
