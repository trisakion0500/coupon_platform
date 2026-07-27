DROP PROCEDURE IF EXISTS `SPTG_ACTIVE_CAMPAIGN_LIST`;
DELIMITER $$
CREATE PROCEDURE `SPTG_ACTIVE_CAMPAIGN_LIST` ()
COMMENT 'test_game_server 전용 - 활성 캠페인 + 소속 프로젝트 자격증명 조회 (docs/20_TEST_GAME_SERVER.md 10.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SPTG_ACTIVE_CAMPAIGN_LIST
    -- 작성 : 2026.07.27 trisakion
    -- 내용 : coupon_platform 제품 SP가 아니라 test_game_server(완전 독립 테스트 클라이언트) 전용
    --        지원 SP다 - docs/20_TEST_GAME_SERVER.md 10장 참고. 일반 SP와 달리 RESULT 단일 컬럼
    --        규약(02_DEV_CONVENTIONS.md 3.4)을 따르지 않는다 - 호출자가 SpExecutorService가 아니라
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
