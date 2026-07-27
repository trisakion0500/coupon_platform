DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_APPROVE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_APPROVE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 승인할 캠페인 ID
    IN i_edit_count         INT UNSIGNED,     -- 낙관적 동시성 제어 토큰(2.3 조회 시 받은 edit_count 그대로)
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 승인 - edit_count 낙관적 락 + OPERATOR 승인불가(20001) + approval_status 2->3 조건부 UPDATE (19_CAMPAIGN_API.md 2.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_APPROVE
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 + 승인권한 재검증 -> 조건부 UPDATE 순으로
    --        처리한다. 승인은 SUPER_ADMIN/DEVELOPER/MANAGER만 가능하고 OPERATOR는 불가하다
    --        (19_CAMPAIGN_API.md 2.6 Permission) - FN_GET_PROJECT_ROLE_CODE로 얻은 role_code가
    --        40(OPERATOR)이면 "배정은 있으나 승인 권한이 없는" 경우이므로 이것도 20001로 응답한다
    --        (배정 자체가 없는 경우와 동일한 코드를 쓴다 - 이 도메인은 "권한 부족"과 "배정 없음"을
    --        세분화하지 않는다, 04_DEV_CONVENTIONS.md 3.2 원칙과 동일하게 SP가 최종 방어선).
    --        log_coupon_campaign(action=40 APPROVE) 기록은 SP_CAMPAIGN_CREATE와 동일한 이유로
    --        이 SP가 직접 하지 않는다 - 반환 행 전체를 TS 서비스가
    --        SP_LOG_COUPON_CAMPAIGN_CREATE(로그 DB)에 그대로 전달한다.
    --        2026-07-20: edit_count 낙관적 락을 SP_CAMPAIGN_UPDATE뿐 아니라 이 SP에도 적용한다.
    --        approval_status=2 조건만으로는 "승인자가 검토한 그 시점의 캠페인 내용"과 실제로
    --        승인하는 시점의 내용이 같은지 보장하지 못한다 - 예를 들어 승인자가 화면에서
    --        reward_data를 검토하고 승인 버튼을 누르는 사이에 다른 사람이 그 내용을 수정했다면,
    --        approval_status는 여전히 2라서 이 조건만으로는 통과하지만 승인자는 자신이 검토한
    --        것과 다른 버전을 승인하게 된다(사용자 지적 - 캠페인을 바꾸는 액션은 승인/거부/상태
    --        변경/수정 순서로 다양하게 섞여 들어올 수 있어 SP_CAMPAIGN_UPDATE 하나만 검증해서는
    --        부족하다). ROW_COUNT()=0이면 edit_count 불일치(30005)인지 승인 대상 상태 자체가
    --        아닌지(30004, 19_CAMPAIGN_API.md 2.6 State Transition/1.3 종료 잠금)를 재조회로
    --        구분한다 - SP_CAMPAIGN_UPDATE와 동일한 패턴.
    -- 수정1: 2026.07.22 trisakion — log_coupon_campaign.created_by_name(19_CAMPAIGN_API.md 4.2
    --        조회 API 설계 중 소급 추가) 채우기 위해 requester_name을 결과에 함께 반환한다
    --        (SP_CAMPAIGN_CREATE와 동일한 이유/패턴).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_role             TINYINT UNSIGNED DEFAULT NULL;
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

        IF FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SET v_role = 10;
        ELSE
            SET v_role = FN_GET_PROJECT_ROLE_CODE(i_requester_user_id, v_project_id);
        END IF;

        IF v_role IS NULL OR v_role > 30 THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `coupon_campaign`
        SET
            `approval_status` = 3,
            `approved_by`      = i_requester_user_id,
            `approved_at`      = NOW(),
            `updated_by`       = i_requester_user_id,
            `edit_count`       = `edit_count` + 1
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `edit_count` = i_edit_count
          AND `approval_status` = 2
          AND `status` <> 4;

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
