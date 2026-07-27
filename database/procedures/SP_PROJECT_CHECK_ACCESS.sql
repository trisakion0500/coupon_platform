DROP PROCEDURE IF EXISTS `SP_PROJECT_CHECK_ACCESS`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_CHECK_ACCESS` (
    IN i_project_id        BIGINT UNSIGNED,  -- 확인할 프로젝트 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 접근권한만 확인 (19_CAMPAIGN_API.md 4.3, 로그 DB 조회 API의 메인 DB 사전 체크 전용)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_CHECK_ACCESS
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : SUPER_ADMIN 우회 또는 FN_CHECK_PROJECT_ACCESS(캠페인 도메인과 동일한 "user_role에
    --        실제 활성 배정된 project_id인가" 스코핑 규칙, 19_CAMPAIGN_API.md 1.2)만 확인하는
    --        가장 작은 단위의 SP다 - 데이터를 반환하지 않고 RESULT(0/20001)만 응답한다.
    --        SP_CAMPAIGN_LIST 등 캠페인 도메인 SP는 coupon_campaign이 메인 DB에 있어 이 체크를
    --        SP 안에 바로 인라인할 수 있지만, GET /coupon-use-logs(4.3)가 조회하는 log_coupon_use
    --        는 로그 DB에 있어 메인 DB의 user_role을 참조할 방법이 없다(04_DEV_CONVENTIONS.md
    --        1장/3.2) - 그래서 "메인 DB에서 접근권한만 먼저 확인 → 통과하면 로그 DB에서 목록
    --        조회"하는 2단계 패턴(04_DEV_CONVENTIONS.md 3.2)이 필요했고, 이 SP가 그 1단계를
    --        전담한다. 프로젝트 존재 여부는 별도로 확인하지 않는다 - SP_CAMPAIGN_LIST와 동일하게
    --        SUPER_ADMIN은 존재하지 않는 project_id에도 이 체크를 그냥 통과하며(그 뒤 로그 DB
    --        조회에서 자연히 0건), 그 외 role은 존재하지 않는 project_id에 애초에 배정이 있을 수
    --        없어 FN_CHECK_PROJECT_ACCESS가 false를 반환해 동일하게 20001로 걸러진다.
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

    IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
       AND NOT FN_CHECK_PROJECT_ACCESS(i_requester_user_id, i_project_id) THEN
        SELECT 20001 AS RESULT;
    ELSE
        SELECT 0 AS RESULT;
    END IF;
END$$

DELIMITER ;
