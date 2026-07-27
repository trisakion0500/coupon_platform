-- ------------------------------------------------------------------------------------------------------------ --
-- test_game_server 전용 지원 SP 통합본 (SPTG_ 접두어, docs/21_TEST_GAME_SERVER.md 10장)
-- coupon_platform 제품 SP 카탈로그(database/procedures/all_procedures.sql)와는 별개다.
-- 알파벳순 정렬. 개별 파일을 고치면 이 파일도 함께 동기화할 것.
-- ------------------------------------------------------------------------------------------------------------ --

DROP PROCEDURE IF EXISTS `SPTG_ACTIVE_CAMPAIGN_LIST`;
DELIMITER $$
CREATE PROCEDURE `SPTG_ACTIVE_CAMPAIGN_LIST` ()
COMMENT 'test_game_server 전용 - 활성 캠페인 + 소속 프로젝트 자격증명 조회 (docs/21_TEST_GAME_SERVER.md 10.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SPTG_ACTIVE_CAMPAIGN_LIST
    -- 작성 : 2026.07.27 trisakion
    -- 내용 : coupon_platform 제품 SP가 아니라 test_game_server(완전 독립 테스트 클라이언트) 전용
    --        지원 SP다 - docs/21_TEST_GAME_SERVER.md 10장 참고. 일반 SP와 달리 RESULT 단일 컬럼
    --        규약(04_DEV_CONVENTIONS.md 3.4)을 따르지 않는다 - 호출자가 SpExecutorService가 아니라
    --        test_game_server 자체 mysql2 풀이고, 실패할 비즈니스 조건이 없는 순수 조회라 빈
    --        결과셋 자체가 에러가 아니라 "이번엔 활성 캠페인 없음"을 뜻할 뿐이다.
    --        api_secret/api_secret_prev는 암호문 그대로 반환한다 - 복호화는 test_game_server의
    --        testing/decryptProjectSecret.ts가 SP 밖에서 수행한다(SP는 ENCRYPTION_KEY를 모른다).
    -- ------------------------------------------------------------------------------------------------------------ --
    SELECT
        cc.`coupon_campaign_id`, cc.`project_id`, cc.`name`, cc.`code_type`,
        cc.`use_limit_per_user`, cc.`usable_qty`, cc.`used_qty`,
        p.`api_key`, p.`api_secret`, p.`api_secret_prev`
    FROM `coupon_campaign` cc
    JOIN `project` p ON p.`project_id` = cc.`project_id`
    WHERE cc.`status` = 2
      AND cc.`approval_status` IN (1, 3)
      AND NOW() BETWEEN cc.`campaign_start` AND cc.`campaign_end`
      AND p.`status` = 1;
END$$
DELIMITER ;

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

DROP PROCEDURE IF EXISTS `SPTG_USAGE_COUNT`;
DELIMITER $$
CREATE PROCEDURE `SPTG_USAGE_COUNT` (
    IN i_project_id   BIGINT UNSIGNED, -- 대상 프로젝트 ID (coupon_code.project_id 스코핑용)
    IN i_code_value   VARCHAR(50),     -- 대상 코드값
    IN i_game_user_id VARCHAR(100)     -- NULL이면 코드 전체 건수, 지정 시 해당 유저로 한정
)
COMMENT 'test_game_server 전용 - 동시성 레이스 사후검증용 coupon_code_usage 실제 행 수 (docs/21_TEST_GAME_SERVER.md 10.2, 6.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SPTG_USAGE_COUNT
    -- 작성 : 2026.07.27 trisakion
    -- 내용 : docs/21_TEST_GAME_SERVER.md 10장 참고(RESULT 규약 미적용). 6.3 동시성 레이스
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

