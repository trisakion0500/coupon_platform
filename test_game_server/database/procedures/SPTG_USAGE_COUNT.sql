DROP PROCEDURE IF EXISTS `SPTG_USAGE_COUNT`;
DELIMITER $$
CREATE PROCEDURE `SPTG_USAGE_COUNT` (
    IN i_project_id   BIGINT UNSIGNED, -- 대상 프로젝트 ID (coupon_code.project_id 스코핑용)
    IN i_code_value   VARCHAR(50),     -- 대상 코드값
    IN i_game_user_id VARCHAR(100)     -- NULL이면 코드 전체 건수, 지정 시 해당 유저로 한정
)
COMMENT 'test_game_server 전용 - 동시성 레이스 사후검증용 coupon_code_usage 실제 행 수 (docs/20_TEST_GAME_SERVER.md 10.2, 6.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SPTG_USAGE_COUNT
    -- 작성 : 2026.07.27 trisakion
    -- 내용 : docs/20_TEST_GAME_SERVER.md 10장 참고(RESULT 규약 미적용). 6.3 동시성 레이스
    --        시나리오가 Promise.all 버스트 이후 HTTP 응답 코드 분포만으로는 못 잡는 이중 확정 같은
    --        문제를 DB에서 직접 재확인하기 위해 쓴다.
    -- ------------------------------------------------------------------------------------------------------------ --
    SELECT COUNT(*) AS usage_count
    FROM `coupon_code_usage` ccu
    JOIN `coupon_code` cc ON cc.`coupon_code_id` = ccu.`coupon_code_id`
    WHERE cc.`project_id` = i_project_id
      AND cc.`code_value` = i_code_value
      AND (i_game_user_id IS NULL OR ccu.`game_user_id` = i_game_user_id);
END$$
DELIMITER ;
