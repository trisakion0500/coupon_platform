DROP PROCEDURE IF EXISTS `SPTG_EXHAUSTED_FIXED_TARGET`;
DELIMITER $$
CREATE PROCEDURE `SPTG_EXHAUSTED_FIXED_TARGET` ()
COMMENT 'test_game_server 전용 - use_limit_per_user에 도달한 FIXED (campaign,game_user_id) 조합 + 소속 프로젝트 자격증명 무작위 1건 (docs/21_TEST_GAME_SERVER.md 10.2, 6.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SPTG_EXHAUSTED_FIXED_TARGET
    -- 작성 : 2026.07.27 trisakion
    -- 내용 : docs/21_TEST_GAME_SERVER.md 10장 참고(RESULT 규약 미적용). 서브쿼리에서 먼저
    --        (coupon_campaign_id, game_user_id) 단위로 GROUP BY + HAVING으로 한도초과 조합만
    --        걸러낸 뒤 coupon_code/project를 조인한다 - camp.use_limit_per_user를 coupon_code
    --        컬럼과 함께 그대로 GROUP BY 없이 SELECT/HAVING에 넣으면 MySQL ONLY_FULL_GROUP_BY
    --        모드가 거부하므로(coupon_code_id가 GROUP BY 키에 없어 함수적 종속을 증명 못 함)
    --        이렇게 2단계로 나눴다. code_type=2(FIXED)로 한정한다 - RANDOM도 이론상 같은
    --        한도초과 조합이 나올 수 있지만 그건 6.4의 SPTG_EXHAUSTED_RANDOM_CODE가 이미 다루는
    --        영역이라 여기서는 섞이지 않게 배제한다. `camp.use_limit_per_user > 1` 조건도 함께
    --        건다 - limit=1인 조합은 20_COUPON_USAGE_API.md 2.1의 멱등 규칙(같은 코드+같은
    --        game_user_id 재시도 시 에러가 아니라 최초 성공 응답을 그대로 재반환)이 적용돼
    --        reserve를 다시 불러도 33003이 아니라 200이 돌아오므로, "한도초과 에러 재현"이라는
    --        이 SP의 목적과 맞지 않아 애초에 후보에서 뺀다(그 케이스는 6.2 멱등 재시도 시나리오의
    --        영역). S2S 호출에 필요한 project 자격증명을 이 SP가 직접 함께 반환하는 이유는
    --        SPTG_EXHAUSTED_RANDOM_CODE와 동일(현재 선택된 캠페인과 무관하게 DB 전체에서 대상을
    --        찾으므로).
    -- ------------------------------------------------------------------------------------------------------------ --
    SELECT
        t.`coupon_campaign_id`, t.`game_user_id`, cc.`code_value`, cc.`project_id`,
        p.`api_key`, p.`api_secret`, p.`api_secret_prev`
    FROM (
        SELECT ccu.`coupon_campaign_id`, ccu.`game_user_id`
        FROM `coupon_code_usage` ccu
        JOIN `coupon_campaign` camp ON camp.`coupon_campaign_id` = ccu.`coupon_campaign_id`
        WHERE camp.`code_type` = 2
          AND camp.`use_limit_per_user` > 1
        GROUP BY ccu.`coupon_campaign_id`, ccu.`game_user_id`, camp.`use_limit_per_user`
        HAVING COUNT(*) >= camp.`use_limit_per_user`
    ) t
    JOIN `coupon_code` cc ON cc.`coupon_campaign_id` = t.`coupon_campaign_id`
    JOIN `project` p ON p.`project_id` = cc.`project_id`
    WHERE p.`status` = 1
    ORDER BY RAND()
    LIMIT 1;
END$$
DELIMITER ;
