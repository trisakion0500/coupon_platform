DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_ABORT`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_ABORT` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_stale_seconds      INT UNSIGNED,     -- "이만큼 updated_at이 안 움직였으면 멈춘 것으로 본다" 임계값(초)
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'generation_status=2(진행중) 정체 캠페인 수동 복구 - RANDOM은 실패(4)로, FIXED는 대기(1)로 (17_CAMPAIGN_API.md 3.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_ABORT
    -- 작성 : 2026.07.21 trisakion
    -- 내용 : 서버 프로세스가 백그라운드 생성 루프 도중 재시작/크래시되면(순수 인메모리
    --        fire-and-forget이라 재시작 시 완전히 유실됨) 캠페인이 generation_status=2에
    --        영구히 멈출 수 있다 - ISSUE는 1만, RETRY는 4만 받으므로 둘 다 손댈 수 없는
    --        상태다(사용자 리뷰에서 발견). 이 SP는 관리자(SUPER_ADMIN/DEVELOPER/MANAGER,
    --        role_code<=30 - OPERATOR 제외, 승인/반려와 동일한 급의 판단이라 그 선례를 따름)가
    --        수동으로 "포기 선언"해서 정체를 풀 수 있게 한다.
    --        "관리자가 요청하면 무조건 강제 전환"이 아니다 - `updated_at`(coupon_campaign의
    --        ON UPDATE CURRENT_TIMESTAMP 컬럼, SP_CAMPAIGN_CODE_GENERATE_ONE이 코드를 하나
    --        만들 때마다 자동 갱신됨)이 `i_stale_seconds` 이상 안 움직였을 때만 허용한다 -
    --        호출자의 판단을 그대로 믿지 않고 SP가 최소한의 근거(실제로 최근에 진행된 흔적이
    --        없음)를 재확인한다는 원칙(02_DEV_CONVENTIONS.md 3.2와 같은 정신).
    --        `i_stale_seconds`는 앱(CampaignService.computeAbortStaleThresholdSec)이
    --        CODE_GENERATION_MAX_DB_RETRIES/RETRY_BASE_DELAY_MS/ABORT_STALE_SAFETY_MULTIPLIER로
    --        계산해서 넘긴다 - 정상적으로 살아있는 루프가 DB 일시 오류 재시도로 만들 수 있는
    --        이론상 최대 무진행 구간(backoff 누적합)보다 충분히 크게 잡아, 실제로 살아있는
    --        job을 성급하게 끊는 사고를 막는다(재시도 설정이 바뀌면 이 임계값도 자동으로 같이
    --        늘어남 - 별도 env로 독립시키지 않은 이유).
    --        code_type으로 되돌릴 상태가 다르다:
    --        - RANDOM(1): generation_status=4(실패)로 전환 - 이후 기존 POST /codes/retry를
    --          그대로 호출하면 이미 만든 generated_qty부터 이어서 생성된다(TS 코드 변경 없음).
    --        - FIXED(2): generation_status=1(대기)로 전환 - FIXED는 성공 아니면 INSERT 자체가
    --          전부 롤백되는 all-or-nothing이라 "부분 진행"이라는 개념이 없다(05_COUPON_ISSUANCE_
    --          SCENARIO.md 1장의 "FIXED는 4에 도달하지 않는다" 전제와 동일한 이유) - 처음부터
    --          다시 POST /codes로 재발급하면 된다.
    --        edit_count/log_coupon_campaign 둘 다 대상이 아니다 - 3.1/3.2와 동일한 축이라
    --        (SP_CAMPAIGN_CODE_ISSUE 헤더 주석 참고).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT UNSIGNED  DEFAULT NULL;
    DECLARE v_code_type   TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_role        TINYINT UNSIGNED DEFAULT NULL;

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

        SELECT `project_id`, `code_type` INTO v_project_id, v_code_type
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

        IF v_role > 30 THEN
            -- OPERATOR(40) - 배정은 있으나 이 판단(승인/반려급)을 할 권한이 없음
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF v_code_type = 1 THEN
            UPDATE `coupon_campaign`
            SET `generation_status` = 4,
                `generation_error` = '관리자에 의해 강제 중단됨(생성 진행 정체 판정)'
            WHERE `coupon_campaign_id` = i_coupon_campaign_id
              AND `generation_status` = 2
              AND `status` <> 4
              AND `updated_at` <= NOW() - INTERVAL i_stale_seconds SECOND;
        ELSE
            UPDATE `coupon_campaign`
            SET `generation_status` = 1
            WHERE `coupon_campaign_id` = i_coupon_campaign_id
              AND `generation_status` = 2
              AND `status` <> 4
              AND `updated_at` <= NOW() - INTERVAL i_stale_seconds SECOND;
        END IF;

        IF ROW_COUNT() = 0 THEN
            -- generation_status가 이미 2가 아니거나(정상 종료/이미 조치됨), 캠페인이
            -- 종료됐거나(status=4, 1.3 원칙), 아직 stale 기준에 못 미침(최근에 실제로 진행된
            -- 흔적이 있어 살아있을 가능성이 높음) - 어느 쪽이든 이유를 구분하지 않고 30004로
            -- 답한다(다른 코드 발급 SP들과 동일한 관례).
            SELECT 30004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `coupon_campaign_id`, `generation_status`
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;
