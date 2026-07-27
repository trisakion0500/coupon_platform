DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CHANGE_STATUS`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CHANGE_STATUS` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_edit_count         INT UNSIGNED,     -- 낙관적 동시성 제어 토큰(2.3 조회 시 받은 edit_count 그대로)
    IN i_status             TINYINT UNSIGNED, -- 전환할 목표 상태
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 상태변경 - edit_count 낙관적 락 + 전이표 전체를 하나의 조건부 UPDATE로 원자 처리 (19_CAMPAIGN_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CHANGE_STATUS
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001, role_code
    --        값 자체는 필요 없어 FN_GET_PROJECT_ROLE_CODE 대신 boolean 버전을 쓴다) -> 허용된
    --        전이표(19_CAMPAIGN_API.md 2.5) + edit_count 일치를 WHERE절 하나에 담아 조건부
    --        UPDATE로 원자 처리한다(04_DEV_CONVENTIONS.md 4장 "동시성이 필요한 UPDATE는 조건부
    --        갱신 우선"). ROW_COUNT()=0이면(존재/권한은 이미 통과했으므로) edit_count 불일치인지
    --        전이표 위반인지 재조회로 진단해 30005/30004로 구분한다 - SP_CAMPAIGN_UPDATE와 동일한
    --        패턴(coupon_campaign.sql 헤더 주석 참고). i_status가 전이표에 아예 없는 값이어도
    --        WHERE절의 어떤 OR 분기와도 매칭되지 않아 자연스럽게 0건으로 걸러진다.
    --        log_coupon_campaign(action=30 STATUS_CHANGE) 기록은 SP_CAMPAIGN_CREATE와 동일한
    --        이유로 이 SP가 직접 하지 않는다 - 반환 행 전체를 TS 서비스가
    --        SP_LOG_COUPON_CAMPAIGN_CREATE(로그 DB)에 그대로 전달한다.
    --        2026-07-20: edit_count 낙관적 락을 SP_CAMPAIGN_UPDATE뿐 아니라 이 SP에도 적용 —
    --        "승인 이후 상태변경", "상태변경 이후 수정"처럼 캠페인을 바꾸는 액션들은 어떤 순서로도
    --        섞여 들어올 수 있어(사용자 지적), 특정 SP 하나만 검증해서는 부족하고 이 행을 바꾸는
    --        쓰기 액션 전부가 "내가 마지막으로 본 버전이 맞는지"를 동일하게 검증해야 한다 —
    --        예를 들어 운영자가 화면에서 본 캠페인 내용과 실제로 상태를 바꾸는 시점의 내용이
    --        다르면(그 사이 누가 캠페인 필드를 수정했다면) 그것도 감지해야 하기 때문이다.
    -- 수정1: 2026.07.22 trisakion — log_coupon_campaign.created_by_name(19_CAMPAIGN_API.md 4.2
    --        조회 API 설계 중 소급 추가) 채우기 위해 requester_name을 결과에 함께 반환한다
    --        (SP_CAMPAIGN_CREATE와 동일한 이유/패턴).
    -- 수정2: 2026.07.25 trisakion — 활성화(1→2)/재활성화(3→2) 전이에 `campaign_end > NOW()`
    --        조건을 추가. 기존엔 approval_status만 확인해 이미 사용기간이 지난 캠페인도
    --        활성화할 수 있었고, 그러면 진입하자마자 "활성" 상태인데 reserve는 자체 시간
    --        조건(coupon_campaign.sql 동시성 절 참고) 때문에 즉시 막혀 겉보기와 실제가
    --        어긋나는 상태가 됐다. 기간이 이미 지난 상태에서 "활성"으로 들어가는 진입 자체를
    --        막는 것이며, 이미 활성인 캠페인이 활성 상태로 있는 도중 기간이 지나는 것(자연 만료)
    --        은 이 조건과 무관한 별개 문제라 여기서 다루지 않는다 — 수정/승인/반려/코드발급은
    --        기간 만료와 무관하게 계속 허용해야 하므로(연장 수정으로 되살리는 경로 보존) 이
    --        전이(2.5)에만 좁게 적용한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id       BIGINT UNSIGNED  DEFAULT NULL;
    DECLARE v_check_edit_count INT UNSIGNED     DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id
        ) THEN
            SELECT 31004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `project_id` INTO v_project_id
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_PROJECT_ACCESS(i_requester_user_id, v_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `coupon_campaign`
        SET `status` = i_status, `updated_by` = i_requester_user_id, `edit_count` = `edit_count` + 1
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `edit_count` = i_edit_count
          AND (
              (`status` = 1 AND i_status = 2 AND `approval_status` IN (1, 3) AND `campaign_end` > NOW()) OR
              (`status` = 1 AND i_status = 4) OR
              (`status` = 2 AND i_status = 3) OR
              (`status` = 2 AND i_status = 4) OR
              (`status` = 3 AND i_status = 2 AND `approval_status` IN (1, 3) AND `campaign_end` > NOW()) OR
              (`status` = 3 AND i_status = 4)
          );

        IF ROW_COUNT() = 0 THEN
            SELECT `edit_count` INTO v_check_edit_count
            FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

            IF v_check_edit_count <> i_edit_count THEN
                SELECT 30005 AS RESULT;
            ELSE
                SELECT 30004 AS RESULT;
            END IF;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`, `edit_count`,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS `requester_name`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;
