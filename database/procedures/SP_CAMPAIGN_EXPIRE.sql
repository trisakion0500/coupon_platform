DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_EXPIRE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_EXPIRE` (
) COMMENT '사용기간이 지난 활성 캠페인 자동 종료 - 배치 전용, 호출자 컨텍스트 없음 (19_CAMPAIGN_API.md 5장, CAMPAIGN_EXPIRY_CRON)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_EXPIRE
    -- 작성 : 2026.07.25 trisakion
    -- 내용 : status=2(활성) AND approval_status IN(1,3)(승인불요/승인완료) AND
    --        campaign_end<=NOW()인 캠페인을 일괄로 status=4(종료)로 전환하는 배치 전용 SP다.
    --        "사용기간이 끝났는데도 화면엔 활성으로 남아있는" 상태를 없애기 위함 — reserve는
    --        이미 자체 시간조건(coupon_campaign.sql 동시성 절)으로 막혀있어 정합성 문제는
    --        아니고 순수하게 상태 라벨을 실제와 맞추는 목적이다. status=1(대기)인 캠페인은
    --        대상이 아니다 — 관리자가 나중에 쓰려고 일부러 활성화하지 않고 대기 상태로 남겨둔
    --        경우가 있어(사용자 확인), 활성화된 적도 없는 캠페인까지 자동으로 손대지 않는다.
    --
    --        approval_status IN(1,3) 조건은 사실 status=2 도달 시점에 이미 보장되는 불변조건
    --        (SP_CAMPAIGN_CHANGE_STATUS가 활성화 전이에 이 조건을 강제)이라 이론상 항상 참이지만,
    --        "호출자가 넘긴 값을 그대로 안 믿고 SP가 재확인한다"는 이 프로젝트 원칙과 같은 결로
    --        방어적으로 명시한다.
    --
    --        임시테이블로 대상 ID를 먼저 캡처(FOR UPDATE로 잠가 그 사이 다른 트랜잭션이 끼어드는
    --        걸 방지)한 뒤, 그 ID들에 대해서만 조건을 다시 확인하며 UPDATE한다 — 캡처와 UPDATE
    --        사이에 관리자의 수동 상태변경/기간연장(PATCH)이 먼저 커밋되면 재확인 조건에 걸려
    --        자연히 스킵되고, 최종 SELECT도 실제로 status=4가 된 행만 반환해 허위로 "방금
    --        종료됨"이라고 잘못 보고하지 않는다.
    --
    --        updated_by는 NULL로 남긴다(이 컬럼은 원래 nullable, 사람이 아닌 배치가 한 변경이라
    --        특정 user_id를 넣을 이유가 없다). 반면 log_coupon_campaign.created_by는 NOT NULL
    --        이라 호출부(CampaignExpiryService)가 created_by=0(실제 user_id는 1부터 시작하므로
    --        안전한 sentinel)/created_by_name='SYSTEM'을 채워 로그를 남긴다 — 이 프로젝트
    --        최초의 "시스템이 수행한 액션" 로그 컨벤션이다(04_DEV_CONVENTIONS.md 4.2).
    --
    --        RANDOM 백그라운드 코드생성이 마침 진행중이었다면 SP_CAMPAIGN_CODE_GENERATE_ONE의
    --        기존 status<>4 가드가 다음 시도에서 자연히 멈춘다(07_COUPON_ISSUANCE_SCENARIO.md
    --        2.5와 동일한 메커니즘 — 이 SP가 새로 신경 쓸 부분이 없다).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        DROP TEMPORARY TABLE IF EXISTS `tmp_expiring_campaigns`;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    -- 이전 실행이 실패로 끝나 정리 못 한 잔여물이 같은(풀링된) 커넥션에 남아있을 수 있어 먼저 청소.
    DROP TEMPORARY TABLE IF EXISTS `tmp_expiring_campaigns`;
    CREATE TEMPORARY TABLE `tmp_expiring_campaigns` (
        `coupon_campaign_id` BIGINT UNSIGNED PRIMARY KEY
    );

    START TRANSACTION;

    INSERT INTO `tmp_expiring_campaigns` (`coupon_campaign_id`)
    SELECT `coupon_campaign_id` FROM `coupon_campaign`
    WHERE `status` = 2 AND `approval_status` IN (1, 3) AND `campaign_end` <= NOW()
    FOR UPDATE;

    UPDATE `coupon_campaign` c
    JOIN `tmp_expiring_campaigns` t ON c.`coupon_campaign_id` = t.`coupon_campaign_id`
    SET c.`status` = 4, c.`updated_by` = NULL, c.`edit_count` = c.`edit_count` + 1
    WHERE c.`status` = 2 AND c.`approval_status` IN (1, 3) AND c.`campaign_end` <= NOW();

    SELECT 0 AS RESULT;
    SELECT
        c.`coupon_campaign_id`, c.`project_id`, c.`name`, c.`campaign_start`, c.`campaign_end`,
        c.`code_type`, c.`use_hyphen`, c.`requested_qty`, c.`generated_qty`, c.`generation_status`,
        c.`generation_error`, c.`usable_qty`, c.`used_qty`, c.`use_limit_per_user`, c.`status`,
        c.`approval_status`, c.`approved_by`, c.`approved_at`, c.`reject_reason`, c.`reward_data`,
        c.`created_by`, c.`updated_by`, c.`created_at`, c.`updated_at`, c.`edit_count`
    FROM `coupon_campaign` c
    JOIN `tmp_expiring_campaigns` t ON c.`coupon_campaign_id` = t.`coupon_campaign_id`
    WHERE c.`status` = 4;

    COMMIT;
    DROP TEMPORARY TABLE IF EXISTS `tmp_expiring_campaigns`;
END$$

DELIMITER ;
