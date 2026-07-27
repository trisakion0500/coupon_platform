DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_GENERATION_STALE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_GENERATION_STALE_LIST` (
    IN i_stale_seconds INT UNSIGNED  -- "정체 판정" 임계값(초) — SP_CAMPAIGN_CODE_ABORT와 동일 기준
) COMMENT '정체된(generation_status=2) 코드생성 job 감지 전용 - 상태 변경 없음, 모니터링 크론용 (07_COUPON_ISSUANCE_SCENARIO.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_GENERATION_STALE_LIST
    -- 작성 : 2026.07.23 trisakion
    -- 내용 : POST /codes/abort(SP_CAMPAIGN_CODE_ABORT)가 실제로 상태를 바꿀 때 쓰는 "정체 판정"
    --        조건(generation_status=2 AND status<>4 AND updated_at이 i_stale_seconds 이상
    --        경과)과 완전히 동일한 조건으로 조회만 하는 감지 전용 SP다 — 상태는 전혀 바꾸지
    --        않는다. 스케일아웃 환경에서는 롤링 배포/오토스케일로 백그라운드 생성 루프가 끊기는
    --        일이 더 잦아지는데, 지금까지는 관리자가 화면을 보다가 우연히 발견해야만 알 수
    --        있었다(abort 자체는 이미 DB 상태 기반이라 어느 인스턴스가 호출해도 안전하지만, 이걸
    --        "발견"하는 과정이 수동이었다는 뜻) — 그래서 감지만 자동화하는 모니터링 크론
    --        (StaleCodeGenerationMonitorService)을 신설하며 이 SP를 함께 만든다. 실제 복구
    --        (abort+재시도)는 여전히 관리자가 수동으로 판단해 트리거한다 — "정체됐다고 시스템이
    --        자동으로 포기 선언하지 않는다"는 SP_CAMPAIGN_CODE_ABORT의 기존 원칙을 그대로 유지.
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

    SELECT 0 AS RESULT;
    SELECT
        `coupon_campaign_id`, `project_id`, `code_type`,
        `generated_qty`, `requested_qty`, `updated_at`
    FROM `coupon_campaign`
    WHERE `generation_status` = 2
      AND `status` <> 4
      AND `updated_at` <= NOW() - INTERVAL i_stale_seconds SECOND;
END$$

DELIMITER ;
