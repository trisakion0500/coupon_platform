DROP PROCEDURE IF EXISTS `SPTG_USABLE_CODE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SPTG_USABLE_CODE_LIST` (
    IN i_coupon_campaign_id BIGINT UNSIGNED -- 대상 캠페인 ID
)
COMMENT 'test_game_server 전용 - 캠페인의 사용가능(status=1) 코드 무작위 상한 100건 (docs/21_TEST_GAME_SERVER.md 10.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SPTG_USABLE_CODE_LIST
    -- 작성 : 2026.07.27 trisakion
    -- 내용 : docs/21_TEST_GAME_SERVER.md 10장 참고(RESULT 규약 미적용). ORDER BY RAND() LIMIT 100으로
    --        대량 발급된 RANDOM 캠페인이라도 결과셋을 상한선 안에서만 반환한다 - 어차피 애플리케이션이
    --        그중 1건만 다시 무작위로 골라 쓰므로 2단계 무작위로도 충분히 고르게 분포한다. FIXED는
    --        캠페인당 코드가 1건뿐이라 이 상한과 무관하게 그 1건만 반환된다.
    -- ------------------------------------------------------------------------------------------------------------ --
    SELECT `coupon_code_id`, `code_value`
    FROM `coupon_code`
    WHERE `coupon_campaign_id` = i_coupon_campaign_id
      AND `status` = 1
    ORDER BY RAND()
    LIMIT 100;
END$$
DELIMITER ;
