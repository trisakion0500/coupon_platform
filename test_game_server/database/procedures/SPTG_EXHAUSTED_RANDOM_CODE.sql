DROP PROCEDURE IF EXISTS `SPTG_EXHAUSTED_RANDOM_CODE`;
DELIMITER $$
CREATE PROCEDURE `SPTG_EXHAUSTED_RANDOM_CODE` ()
COMMENT 'test_game_server 전용 - 이미 사용완료(status=2)된 RANDOM 코드 + 소속 프로젝트 자격증명 무작위 1건 (docs/21_TEST_GAME_SERVER.md 10.2, 6.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SPTG_EXHAUSTED_RANDOM_CODE
    -- 작성 : 2026.07.27 trisakion
    -- 내용 : docs/21_TEST_GAME_SERVER.md 10장 참고(RESULT 규약 미적용). status=2(사용완료)는
    --        coupon_code.sql 헤더 주석상 RANDOM 전용 값이라 code_type 조인 없이도 자연히
    --        RANDOM 코드만 걸린다. 6.4 "이미 소진된 쿠폰 재시도" 시나리오가 이 코드로 reserve를
    --        재호출해 33001(코드 이미 소모됨)이 정확히 돌아오는지 검증한다. 이 시나리오는 현재
    --        선택된 캠페인(SPTG_ACTIVE_CAMPAIGN_LIST)과 무관하게 DB 전체에서 대상을 찾으므로,
    --        S2S 호출에 필요한 project 자격증명도 SPTG_ACTIVE_CAMPAIGN_LIST와 동일하게 이 SP가
    --        직접 함께 반환한다(호출부가 다른 SP 결과에서 우연히 끼워맞추지 않도록).
    -- ------------------------------------------------------------------------------------------------------------ --
    SELECT
        c.`coupon_code_id`, c.`project_id`, c.`coupon_campaign_id`, c.`code_value`,
        p.`api_key`, p.`api_secret`, p.`api_secret_prev`
    FROM `coupon_code` c
    JOIN `project` p ON p.`project_id` = c.`project_id`
    WHERE c.`status` = 2
      AND p.`status` = 1
    ORDER BY RAND()
    LIMIT 1;
END$$
DELIMITER ;
