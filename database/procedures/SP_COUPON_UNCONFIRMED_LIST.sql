DROP PROCEDURE IF EXISTS `SP_COUPON_UNCONFIRMED_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_COUPON_UNCONFIRMED_LIST` (
    IN i_project_id  BIGINT UNSIGNED,  -- S2S 인증으로 스코핑된 project_id
    IN i_game_user_id VARCHAR(100),    -- 지정 시 특정유저 조회 모드(NULL이면 전체유저 조회)
    IN i_campaign_id BIGINT UNSIGNED,  -- 두 모드 공통 선택 필터 (NULL이면 전체)
    IN i_page_size   INT,              -- 전체유저 조회 모드에서만 사용(특정유저 모드면 NULL)
    IN i_offset      INT               -- 전체유저 조회 모드에서만 사용(특정유저 모드면 NULL)
) COMMENT '미컨슘(confirm 안 된) 쿠폰 사용 조회 - 특정유저 전체반환/전체유저 페이지네이션 (18_COUPON_USAGE_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COUPON_UNCONFIRMED_LIST
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : 06_COUPON_USAGE_SCENARIO.md 3장 - 두 모드(특정유저/전체유저) 모두 실제 쿼리는
    --        coupon_code_usage.project_id(비정규화 컬럼) 기준으로 스코핑하고 confirmed_at IS
    --        NULL 조건은 공통이다. game_user_id만으로 조회하는 특정유저 모드도 project_id로
    --        함께 스코핑해 다른 프로젝트의 동일 game_user_id 데이터가 섞이지 않는다(3.2 참고).
    --        i_page_size/i_offset이 NULL이면(특정유저 모드) LIMIT을 사실상 무제한으로 취급하는
    --        v_effective_limit(MySQL BIGINT UNSIGNED 최댓값)을 써서, 페이지네이션 유무와
    --        무관하게 하나의 쿼리 경로(총 개수 서브쿼리 + LEFT JOIN ... ON TRUE, 02_DEV_
    --        CONVENTIONS.md 3.6)를 그대로 재사용한다 - 특정유저 모드에서 total_count는 TS가
    --        응답 조립 시 그냥 버린다(3.1 Response에 없는 필드).
    --        code_value/reward_data는 coupon_code_usage에 비정규화돼 있지 않아 coupon_code/
    --        coupon_campaign을 조인해서 가져온다. 정렬은 게임서버가 오래된 미지급 건부터
    --        재처리하기 유리하도록 created_at ASC로 고정한다(오래된 순).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_effective_limit  BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_effective_offset BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SET v_effective_limit = IF(i_page_size IS NULL, 18446744073709551615, i_page_size);
        SET v_effective_offset = IF(i_offset IS NULL, 0, i_offset);

        SELECT 0 AS RESULT;
        SELECT
            pg.`code_value`, pg.`game_user_id`, pg.`coupon_campaign_id`,
            pg.`reward_data`, pg.`created_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `coupon_code_usage`
            WHERE `project_id` = i_project_id
              AND `confirmed_at` IS NULL
              AND (i_game_user_id IS NULL OR `game_user_id` = i_game_user_id)
              AND (i_campaign_id IS NULL OR `coupon_campaign_id` = i_campaign_id)
        ) cnt
        LEFT JOIN (
            SELECT co.`code_value`, ccu.`game_user_id`, ccu.`coupon_campaign_id`,
                   ca.`reward_data`, ccu.`created_at`
            FROM `coupon_code_usage` ccu
            JOIN `coupon_code` co ON co.`coupon_code_id` = ccu.`coupon_code_id`
            JOIN `coupon_campaign` ca ON ca.`coupon_campaign_id` = ccu.`coupon_campaign_id`
            WHERE ccu.`project_id` = i_project_id
              AND ccu.`confirmed_at` IS NULL
              AND (i_game_user_id IS NULL OR ccu.`game_user_id` = i_game_user_id)
              AND (i_campaign_id IS NULL OR ccu.`coupon_campaign_id` = i_campaign_id)
            ORDER BY ccu.`created_at` ASC
            LIMIT v_effective_limit OFFSET v_effective_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;
