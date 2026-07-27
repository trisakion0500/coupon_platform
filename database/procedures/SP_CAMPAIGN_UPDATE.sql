DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_UPDATE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 수정할 캠페인 ID
    IN i_edit_count         INT UNSIGNED,     -- 낙관적 동시성 제어 토큰(2.3 조회 시 받은 edit_count 그대로)
    IN i_name               VARCHAR(100),     -- 새 캠페인명 (NULL이면 미변경)
    IN i_campaign_start     DATETIME,         -- 새 시작일시 (NULL이면 미변경)
    IN i_campaign_end       DATETIME,         -- 새 종료일시 (NULL이면 미변경)
    IN i_use_limit_per_user INT UNSIGNED,     -- 새 재사용 허용 횟수 (NULL이면 미변경)
    IN i_usable_qty         INT UNSIGNED,     -- 새 실제 사용가능 수량 (NULL이면 미변경)
    IN i_reward_data        JSON,             -- 새 보상 내용 (NULL이면 미변경)
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 수정 - edit_count 낙관적 락 + status/수량/날짜 검증을 UPDATE 하나로 원자 처리 (19_CAMPAIGN_API.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_UPDATE
    -- 작성 : 2026.07.20 trisakion
    -- 수정1: 2026.07.20 trisakion — read-then-update(check-then-act) 방식이 레이스 윈도우를
    --        남긴다는 리뷰 지적을 받아, 검증+수정을 UPDATE 문 하나의 SET/WHERE절 안에서 원자적으로
    --        처리하도록 재작성. 처음엔 coupon_campaign.updated_at을 그대로 낙관적 락 토큰으로
    --        재사용했다.
    -- 수정2: 2026.07.20 trisakion — 실제 동시 요청(Promise.all)으로 재검증하는 과정에서 updated_at
    --        방식의 구멍을 발견: DATETIME이 초 단위까지만 기록되다 보니, 같은 초 안에 승인
    --        처리(SP_CAMPAIGN_APPROVE)와 이 SP의 수정 요청이 겹치면 updated_at 값이 안 바뀐
    --        것처럼 보여 낙관적 락이 충돌을 그냥 통과시켜버리는 사례가 실제로 재현됨. 사용자
    --        제안으로 시간 기반 토큰을 버리고 전용 정수 카운터 coupon_campaign.edit_count로
    --        교체(coupon_campaign.sql 헤더 주석 참고) — 이 캠페인 행을 바꾸는 SP 전부
    --        (UPDATE/CHANGE_STATUS/APPROVE/REJECT)가 성공 시 edit_count를 +1하므로, 타이밍과
    --        무관하게 "그 사이 이 행을 건드린 SP가 있었는지"를 정확히 감지한다.
    -- 내용 : coupon_campaign_id/project_id/code_type/use_hyphen/requested_qty/generated_qty/
    --        generation_status/generation_error/used_qty/status/approval_status류는 이 SP의
    --        파라미터에 아예 없다 - 수정 불가 필드라 애초에 받지 않는다(19_CAMPAIGN_API.md 2.4
    --        Non-Updatable Fields, status는 2.5 전용, approval_status는 2.6/2.7 전용). 단
    --        approval_status/status는 아래 OPERATOR 재승인 규칙에 의해 부수효과로 바뀔 수 있다.
    --        존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_GET_PROJECT_ROLE_CODE, 20001)까지는
    --        기존과 동일하게 사전에 처리한다(프로젝트 배정은 시간이 지나도 안 바뀌는 값이라 이
    --        단계엔 레이스가 없다). 그 다음 단 하나의 UPDATE로:
    --          WHERE: coupon_campaign_id 일치 AND edit_count 일치(낙관적 락) AND status<>4(1.3)
    --                 AND (usable_qty 미지정 OR usable_qty<=generated_qty) AND campaign_end>campaign_start
    --          SET  : edit_count = edit_count + 1, OPERATOR 재승인/강제일시중지 로직을
    --                 status/approval_status 컬럼을 직접 참조하는 IF(...)로 계산
    --        를 원자적으로 처리한다. ROW_COUNT()=0이면 위 조건 중 무엇이 깨졌는지 재조회로 진단해
    --        30005(충돌)/30004(종료)/30003(수량·날짜) 중 하나로 답한다 - SP_USER_APPROVE/REJECT의
    --        "실패 후 재조회로 사유 진단" 패턴과 동일하다.
    --        SET절 순서 주의: MySQL은 단일 테이블 UPDATE의 SET절을 왼쪽부터 순서대로 평가하며,
    --        뒤에 오는 표현식은 앞에서 이미 갱신된 값을 본다(예: `SET a=a+1, b=a`면 b는 새 a값을
    --        본다 - MySQL 공식 문서). `status` 계산이 `approval_status`의 "원래 값"을 봐야 하므로
    --        `status =` 절을 `approval_status =` 절보다 반드시 먼저 둔다 - 순서를 바꾸면 강제
    --        일시중지 조건이 항상 거짓으로 평가되는 조용한 버그가 된다.
    --        OPERATOR 재승인 규칙(2.4 Business Rules): 호출자 role_code가 이 프로젝트에서 40
    --        (OPERATOR)이고 수정 직전 approval_status가 3(승인완료)/4(반려)였다면, 수정과 동시에
    --        approval_status=2(승인대기)로 재전환한다 - OPERATOR는 승인권한이 없어 이미 승인된
    --        내용을 승인 절차 없이 바꾸는 우회를 막기 위함. 이때 status가 2(활성)였다면 함께
    --        3(일시중지)로 강제 전환한다(미승인 내용이 활성 서비스로 계속 노출되는 상황 방지).
    --        role_code<=30(승인권한 role)의 수정은 이 규칙이 발동하지 않고 즉시 그대로 반영된다.
    --        log_coupon_campaign(action=20 UPDATE) 기록은 이 SP가 직접 하지 않는다 - 반환 행
    --        전체를 TS 서비스가 SP_LOG_COUPON_CAMPAIGN_CREATE(로그 DB)에 그대로 전달한다.
    -- 수정3: 2026.07.22 trisakion — log_coupon_campaign.created_by_name(19_CAMPAIGN_API.md 4.2
    --        조회 API 설계 중 소급 추가) 채우기 위해 requester_name을 결과에 함께 반환한다
    --        (SP_CAMPAIGN_CREATE 수정1과 동일한 이유/패턴).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_role                 TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_project_id           BIGINT UNSIGNED  DEFAULT NULL;
    DECLARE v_check_edit_count     INT UNSIGNED     DEFAULT NULL;
    DECLARE v_check_status         TINYINT UNSIGNED DEFAULT NULL;

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
            IF v_role IS NULL THEN
                SELECT 20001 AS RESULT;
                LEAVE proc_block;
            END IF;
        END IF;

        UPDATE `coupon_campaign`
        SET
            `status`             = IF(
                v_role = 40 AND `approval_status` IN (3, 4) AND `status` = 2, 3, `status`
            ),
            `approval_status`    = IF(v_role = 40 AND `approval_status` IN (3, 4), 2, `approval_status`),
            `name`               = COALESCE(i_name, `name`),
            `campaign_start`     = COALESCE(i_campaign_start, `campaign_start`),
            `campaign_end`       = COALESCE(i_campaign_end, `campaign_end`),
            `use_limit_per_user` = COALESCE(i_use_limit_per_user, `use_limit_per_user`),
            `usable_qty`         = COALESCE(i_usable_qty, `usable_qty`),
            `reward_data`        = COALESCE(i_reward_data, `reward_data`),
            `updated_by`         = i_requester_user_id,
            `edit_count`         = `edit_count` + 1
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `edit_count` = i_edit_count
          AND `status` <> 4
          AND (i_usable_qty IS NULL OR i_usable_qty <= `generated_qty`)
          AND COALESCE(i_campaign_end, `campaign_end`) > COALESCE(i_campaign_start, `campaign_start`);

        IF ROW_COUNT() = 0 THEN
            SELECT `edit_count`, `status` INTO v_check_edit_count, v_check_status
            FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

            IF v_check_edit_count <> i_edit_count THEN
                SELECT 30005 AS RESULT;
            ELSEIF v_check_status = 4 THEN
                SELECT 30004 AS RESULT;
            ELSE
                SELECT 30003 AS RESULT;
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
