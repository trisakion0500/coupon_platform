-- ------------------------------------------------------------------------------------------------------------ --
-- 통합 SP/Function 파일 — database/tables/all_tables.sql과 동일한 목적(로컬 개발 편의용 한 번에 적용).
-- 테이블과 달리 SP 사이에는 FK 의존성이 없어 순서 제약이 없다 — 알파벳순으로 나열한다.
-- 개별 파일을 수정하면 이 파일도 반드시 함께 갱신할 것(all_tables.sql과 동일한 동기화 원칙).
-- ------------------------------------------------------------------------------------------------------------ --

-- ============================================================================================================ --
-- SP_CAMPAIGN_APPROVE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_APPROVE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_APPROVE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 승인할 캠페인 ID
    IN i_edit_count         INT UNSIGNED,     -- 낙관적 동시성 제어 토큰(2.3 조회 시 받은 edit_count 그대로)
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 승인 - edit_count 낙관적 락 + OPERATOR 승인불가(20001) + approval_status 2->3 조건부 UPDATE (17_CAMPAIGN_API.md 2.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_APPROVE
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 + 승인권한 재검증 -> 조건부 UPDATE 순으로
    --        처리한다. 승인은 SUPER_ADMIN/DEVELOPER/MANAGER만 가능하고 OPERATOR는 불가하다
    --        (17_CAMPAIGN_API.md 2.6 Permission) - FN_GET_PROJECT_ROLE_CODE로 얻은 role_code가
    --        40(OPERATOR)이면 "배정은 있으나 승인 권한이 없는" 경우이므로 이것도 20001로 응답한다
    --        (배정 자체가 없는 경우와 동일한 코드를 쓴다 - 이 도메인은 "권한 부족"과 "배정 없음"을
    --        세분화하지 않는다, 02_DEV_CONVENTIONS.md 3.2 원칙과 동일하게 SP가 최종 방어선).
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
    --        아닌지(30004, 17_CAMPAIGN_API.md 2.6 State Transition/1.3 종료 잠금)를 재조회로
    --        구분한다 - SP_CAMPAIGN_UPDATE와 동일한 패턴.
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
            `created_by`, `updated_by`, `created_at`, `updated_at`, `edit_count`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;



DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CHANGE_STATUS`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CHANGE_STATUS` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_edit_count         INT UNSIGNED,     -- 낙관적 동시성 제어 토큰(2.3 조회 시 받은 edit_count 그대로)
    IN i_status             TINYINT UNSIGNED, -- 전환할 목표 상태
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 상태변경 - edit_count 낙관적 락 + 전이표 전체를 하나의 조건부 UPDATE로 원자 처리 (17_CAMPAIGN_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CHANGE_STATUS
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001, role_code
    --        값 자체는 필요 없어 FN_GET_PROJECT_ROLE_CODE 대신 boolean 버전을 쓴다) -> 허용된
    --        전이표(17_CAMPAIGN_API.md 2.5) + edit_count 일치를 WHERE절 하나에 담아 조건부
    --        UPDATE로 원자 처리한다(02_DEV_CONVENTIONS.md 4장 "동시성이 필요한 UPDATE는 조건부
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
              (`status` = 1 AND i_status = 2 AND `approval_status` IN (1, 3)) OR
              (`status` = 1 AND i_status = 4) OR
              (`status` = 2 AND i_status = 3) OR
              (`status` = 2 AND i_status = 4) OR
              (`status` = 3 AND i_status = 2 AND `approval_status` IN (1, 3)) OR
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
            `created_by`, `updated_by`, `created_at`, `updated_at`, `edit_count`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;


-- ============================================================================================================ --
-- SP_CAMPAIGN_CODE_ABORT
-- ============================================================================================================ --
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


-- ============================================================================================================ --
-- SP_CAMPAIGN_CODE_GENERATE_ONE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_GENERATE_ONE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_GENERATE_ONE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_project_id         BIGINT UNSIGNED,  -- 비정규화 project_id(coupon_code.project_id)
    IN i_code_value         VARCHAR(50)       -- 앱 레이어(nanoid)가 생성한 코드값 1건
) COMMENT 'RANDOM 코드 1건 생성(내부용) - requested_qty 상한 + generation_status=2/status<>4 가드, INSERT/generated_qty 증가를 트랜잭션으로 원자 처리 (05_COUPON_ISSUANCE_SCENARIO.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_GENERATE_ONE
    -- 작성 : 2026.07.21 trisakion
    -- 수정1: 2026.07.21 trisakion — 리뷰에서 이 SP가 generated_qty를 requested_qty와 비교 없이
    --        무조건 +1 하고 있다는 걸 발견함. 정상 흐름에선 TS 루프가 딱 필요한 횟수만큼만
    --        호출하므로 문제가 안 드러나지만, "INSERT+COMMIT까지는 성공했는데 응답이 앱에
    --        전달되지 못한" 경우(커넥션 순간 단절 등, lost ack) 앱의 로컬 카운터가 실제 DB 값보다
    --        뒤처진 채로 다음 루프를 돌아 이 SP를 한 번 더 호출할 수 있고, 그러면 상한 체크가
    --        없던 예전 버전은 generated_qty가 requested_qty를 넘어서는 코드를 하나 더 만들어
    --        버렸다. 이번 수정으로 "슬롯 예약(조건부 UPDATE) → 실제 코드 생성" 순서로 뒤집어
    --        구조적으로 봉쇄한다: generated_qty 증가를 requested_qty 미만일 때만 허용하는 조건부
    --        UPDATE로 먼저 시도하고, 그게 실패하면(이미 목표 도달) INSERT 자체를 시도하지 않고
    --        RESULT=0 + 현재(불변) generated_qty만 그대로 반환한다 — TS 루프의
    --        `generatedQty = data[0].generated_qty` 갱신 로직이 이 값을 그대로 받아 while 조건이
    --        자연스럽게 거짓이 되므로, 호출부(campaign.service.ts) 코드는 전혀 손댈 필요가 없다
    --        (이 SP를 몇 번을 더 호출해도 안전한, 사실상 멱등한 "생성 1건, 단 상한 이내"로
    --        재정의됨).
    -- 수정2: 2026.07.21 trisakion — SP_CAMPAIGN_CODE_ABORT 도입에 맞춰, 슬롯 예약 조건부 UPDATE의
    --        WHERE절에 `generation_status=2`도 함께 건다. 관리자가 "오래 멈춘 것으로 보임"
    --        판단하에 abort로 이 job을 강제로 실패(4)/대기(1)로 돌린 뒤에도, 실제로는 아직 살아있던
    --        백그라운드 루프(판단 착오 또는 매우 느린 정상 진행)가 이 SP를 계속 호출할 수 있다 -
    --        이때 generation_status가 더 이상 2가 아니므로 슬롯 예약이 항상 실패하게 만들어
    --        추가 코드 생성을 완전히 차단한다. 다만 이 경우 "이미 목표 도달"과 "job을 빼앗김"을
    --        앱이 구분할 수 있어야 좀비 루프가 무한 재시도(수량 미달로 while 조건이 계속 참)에
    --        빠지지 않으므로, 두 no-op 분기 전부 generated_qty뿐 아니라 generation_status도
    --        함께 반환한다 - TS 루프는 이 값이 2가 아니면 즉시 루프를 중단한다(누군가 이미
    --        최종 상태를 결정했으므로 COMPLETE/FAIL을 또 호출하지 않는다).
    -- 수정3: 2026.07.21 trisakion — 리뷰에서 캠페인이 종료(status=4)돼도 진행 중인 RANDOM 생성
    --        루프를 아무도 못 멈춘다는 걸 발견함(동시성 공백) - SP_CAMPAIGN_CHANGE_STATUS(종료
    --        처리)가 generation_status를 전혀 안 보고, 이 SP도 원래 status를 안 봐서, 종료된
    --        캠페인에 코드가 계속 쌓일 수 있었다. 슬롯 예약 조건부 UPDATE의 WHERE절에
    --        `status<>4`도 함께 걸어 구조적으로 차단한다 - SP_CAMPAIGN_CHANGE_STATUS와 이 SP
    --        둘 다 같은 행에 대한 조건부 UPDATE라 MySQL 행 단위 락이 순서를 직렬화해주므로
    --        타이밍 레이스 없이 안전하다(종료가 먼저 커밋되면 그다음 이 UPDATE는 곧바로 실패).
    --        종료는 generation_status를 건드리지 않는 별개 축이라(coupon_campaign.sql 헤더 주석),
    --        "이미 목표 도달"/"job을 빼앗김(abort)"과 구분하려면 no-op 응답에 `status`도 함께
    --        반환해야 한다 - TS 루프는 `generation_status<>2 OR status=4`면 멈춘다. 종료된
    --        캠페인의 generation_status는 억지로 전이시키지 않는다 - 17_CAMPAIGN_API.md 1.3이
    --        종료된 캠페인의 모든 쓰기 API를 이미 차단하므로 더 손댈 필요가 없는 무해한 상태다.
    -- 내용 : SP_CAMPAIGN_CODE_ISSUE/RETRY로 이미 권한 검증 + generation_status=2(진행중) 선점을
    --        마친 뒤, TS 서비스의 백그라운드 루프가 requested_qty만큼 이 SP를 반복 호출한다
    --        (05_COUPON_ISSUANCE_SCENARIO.md 2.1 R2~R7 루프). 그래서 이 SP 자체는 요청자
    --        재검증을 하지 않는다 - 공개 API에서 직접 호출되는 대상이 아니라 이미 검증된
    --        백그라운드 작업 내부에서만 쓰인다(SP_SESSION_CLEANUP 등 기존 내부 배치 SP와 동일한
    --        원칙). nanoid로 코드값을 만드는 것은 앱 레이어 책임이다 - SQL에는 nanoid가 없고,
    --        코드값 자체를 SP가 생성하면 충돌 시 "새 값으로 재시도"를 SP 안에서 루프 돌려야 해서
    --        오히려 복잡해진다.
    --        처리 순서: (1) "generated_qty+1, WHERE generated_qty<requested_qty AND
    --        generation_status=2 AND status<>4" 조건부 UPDATE로 슬롯을 먼저 예약한다
    --        (02_DEV_CONVENTIONS.md 4장 "조건부 갱신 우선"). ROW_COUNT()=0이면 이미 목표
    --        수량에 도달했거나(정상 종료 경로), 누군가 이 job을 이미 종료시켰거나(abort),
    --        캠페인 자체가 종료됐다는 뜻이므로 코드를 만들지 않고 현재 generated_qty/
    --        generation_status/status를 그대로 반환한다(RESULT=0, no-op 성공). (2) 슬롯 예약에
    --        성공했을 때만 실제 coupon_code INSERT를 시도한다. 코드값 충돌(UNIQUE(project_id,
    --        code_value))은 이 INSERT 문 범위로 좁힌 CONTINUE HANDLER FOR 1062로만 흡수한다
    --        (바깥 EXIT HANDLER FOR SQLEXCEPTION보다 특정 조건 핸들러가 우선) - 충돌이면
    --        ROLLBACK으로 방금 예약한 슬롯(generated_qty 증가분)까지 함께 되돌리고(같은
    --        트랜잭션이라 한 번의 ROLLBACK으로 둘 다 취소됨) 32001을 반환해 앱이 지연 없이 새
    --        랜덤값으로 재시도하게 한다(코드값 재추첨은 backoff 대상이 아님,
    --        05_COUPON_ISSUANCE_SCENARIO.md 2.2 표 참고). 그 외 SQLEXCEPTION(예: DB 커넥션
    --        단절, 락 대기 타임아웃)은 50001로 던져지고, 앱이 이를 잡아 exponential
    --        backoff+jitter 재시도 여부를 판단한다(재시도 자체는 앱 책임 - SP는 한 번의 시도만
    --        담당).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state           CHAR(5)      DEFAULT '00000';
    DECLARE error_no            INT          DEFAULT 0;
    DECLARE error_message       VARCHAR(255) DEFAULT '';
    DECLARE v_duplicate         BOOLEAN          DEFAULT FALSE;
    DECLARE v_generated_qty     INT UNSIGNED     DEFAULT NULL;
    DECLARE v_generation_status TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_status            TINYINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    DECLARE CONTINUE HANDLER FOR 1062 SET v_duplicate = TRUE;

    proc_block: BEGIN
        START TRANSACTION;

        UPDATE `coupon_campaign`
        SET `generated_qty` = `generated_qty` + 1
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `generated_qty` < `requested_qty`
          AND `generation_status` = 2
          AND `status` <> 4;

        IF ROW_COUNT() = 0 THEN
            -- 이미 목표 수량에 도달했거나(정상), SP_CAMPAIGN_CODE_ABORT로 job을 빼앗겼거나,
            -- 캠페인 자체가 종료됐다는 뜻(수정3) - 어느 쪽이든 코드를 만들지 않고 현재 값을
            -- 그대로 보고한다. 앱은 generation_status<>2 OR status=4면 즉시 루프를 멈춰야 한다.
            COMMIT;
            SELECT `generated_qty`, `generation_status`, `status`
                INTO v_generated_qty, v_generation_status, v_status
            FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;
            SELECT 0 AS RESULT;
            SELECT
                v_generated_qty AS generated_qty,
                v_generation_status AS generation_status,
                v_status AS status;
            LEAVE proc_block;
        END IF;

        INSERT INTO `coupon_code` (`coupon_campaign_id`, `project_id`, `code_value`, `status`)
        VALUES (i_coupon_campaign_id, i_project_id, i_code_value, 1);

        IF v_duplicate THEN
            -- INSERT 실패 + 방금 예약한 슬롯(generated_qty+1)을 같은 트랜잭션 ROLLBACK 한 번으로
            -- 함께 되돌린다 - 별도의 "되돌리기 UPDATE"가 필요 없다.
            ROLLBACK;
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        COMMIT;

        SELECT `generated_qty`, `generation_status`, `status`
            INTO v_generated_qty, v_generation_status, v_status
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

        SELECT 0 AS RESULT;
        SELECT
            v_generated_qty AS generated_qty,
            v_generation_status AS generation_status,
            v_status AS status;
    END proc_block;
END$$

DELIMITER ;


-- ============================================================================================================ --
-- SP_CAMPAIGN_CODE_GENERATION_COMPLETE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_GENERATION_COMPLETE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_GENERATION_COMPLETE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED  -- 대상 캠페인 ID
) COMMENT 'RANDOM 코드 생성 완료 처리(내부용) - generation_status 2->3 조건부 UPDATE (05_COUPON_ISSUANCE_SCENARIO.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_GENERATION_COMPLETE
    -- 작성 : 2026.07.21 trisakion
    -- 내용 : TS 백그라운드 루프가 generated_qty=requested_qty에 도달했을 때 호출한다
    --        (SP_CAMPAIGN_CODE_GENERATE_ONE과 동일하게 요청자 재검증 없음 - 내부 배치 전용).
    --        WHERE절에 generation_status=2를 걸어 이미 완료/실패 처리된 캠페인을 중복 전이하지
    --        않도록 조건부 UPDATE로 처리한다.
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

    proc_block: BEGIN
        UPDATE `coupon_campaign`
        SET `generation_status` = 3
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `generation_status` = 2;

        SELECT 0 AS RESULT;
        SELECT `coupon_campaign_id`, `generation_status`
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;


-- ============================================================================================================ --
-- SP_CAMPAIGN_CODE_GENERATION_FAIL
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_GENERATION_FAIL`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_GENERATION_FAIL` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_generation_error   VARCHAR(500)      -- 최종 실패 사유(마지막 재시도의 오류 메시지)
) COMMENT 'RANDOM 코드 생성 최종 실패 처리(내부용) - generation_status 2->4 조건부 UPDATE (05_COUPON_ISSUANCE_SCENARIO.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_GENERATION_FAIL
    -- 작성 : 2026.07.21 trisakion
    -- 내용 : TS 백그라운드 루프가 exponential backoff+jitter 재시도를 모두 소진했을 때 호출한다
    --        (SP_CAMPAIGN_CODE_GENERATE_ONE과 동일하게 요청자 재검증 없음 - 내부 배치 전용).
    --        개별 재시도 시도 자체는 이 테이블에 남기지 않고 애플리케이션 로그로만 남긴다
    --        (05_COUPON_ISSUANCE_SCENARIO.md 2.2 표 - "재시도 소진" 행). WHERE절에
    --        generation_status=2를 걸어 이미 완료 처리된 캠페인을 뒤늦게 실패로 덮어쓰지 않는다.
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

    proc_block: BEGIN
        UPDATE `coupon_campaign`
        SET `generation_status` = 4, `generation_error` = i_generation_error
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `generation_status` = 2;

        SELECT 0 AS RESULT;
        SELECT `coupon_campaign_id`, `generation_status`, `generation_error`
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;


-- ============================================================================================================ --
-- SP_CAMPAIGN_CODE_ISSUE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_ISSUE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_ISSUE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_code_value         VARCHAR(50),      -- FIXED 전용 코드값(RANDOM이면 NULL)
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '코드 발급 요청 - RANDOM은 진행중 전환만(202), FIXED는 코드 1건 동기 등록(200) (17_CAMPAIGN_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_ISSUE
    -- 작성 : 2026.07.21 trisakion
    -- 수정2: 2026.07.22 trisakion — FIXED 완료 UPDATE의 `generated_qty=1` 하드코딩을
    --        `generated_qty=requested_qty`로 교체(SP_CAMPAIGN_CREATE 수정1과 짝). FIXED는
    --        여전히 coupon_code 물리 행 1건만 만들지만, 캠페인 레벨의 requested_qty/
    --        generated_qty는 이제 "코드 개수"가 아니라 "그 1건이 지원할 총 사용가능 횟수"를
    --        의미한다 - 이전엔 강제로 1이라 usable_qty<=generated_qty 제약(17_CAMPAIGN_API.md
    --        2.4) 때문에 FIXED 캠페인이 사실상 전체 통틀어 딱 1번만 소모 가능했다(S2S reserve
    --        스모크 테스트에서 발견, 06_COUPON_USAGE_SCENARIO.md 4.2가 명시한 "서로 다른 유저가
    --        각자 독립적으로 reserve 가능"과 모순).
    -- 수정1: 2026.07.21 trisakion — 리뷰에서 FIXED 동기 완료 UPDATE(구 코드: `SET generated_qty=1,
    --        generation_status=3 WHERE coupon_campaign_id=...`)에 `status<>4` 가드가 빠져있다는 걸
    --        발견함. 이 SP 호출이 INSERT까지 마친 뒤 COMMIT하기 전 그 짧은 순간에 다른 트랜잭션이
    --        `SP_CAMPAIGN_CHANGE_STATUS`로 캠페인을 종료(status→4)시키면, 이 완료 UPDATE는 그걸
    --        모르고 그대로 성공해 종료된 캠페인에 coupon_code가 생성되고 generation_status=3까지
    --        진행돼버렸다(RANDOM 경로는 SP_CAMPAIGN_CODE_GENERATE_ONE 수정3에서 이미 막아뒀는데
    --        같은 SP의 FIXED 분기만 비대칭적으로 뚫려있던 것). 완료 UPDATE의 WHERE절에도
    --        `status<>4`를 추가하고, ROW_COUNT()=0이면(=그 사이 종료됨) 방금 성공한 INSERT까지
    --        같은 트랜잭션 ROLLBACK으로 함께 되돌린 뒤 30004를 반환한다 — generation_status는
    --        선점 당시 값(2)에 그대로 남지만, 05_COUPON_ISSUANCE_SCENARIO.md 2.5가 이미 정한
    --        원칙(종료된 캠페인의 generation_status는 억지로 전이시키지 않는다 — 1.3이 모든 쓰기를
    --        차단하므로 무해함)과 동일하게 취급해 별도로 되돌리지 않는다.
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001 — 이 SP는
    --        role_code 값 자체가 필요 없어 FN_GET_PROJECT_ROLE_CODE 대신 boolean 버전을 쓴다.
    --        05_COUPON_ISSUANCE_SCENARIO.md 1장: 코드 발급은 approval_status와 무관하게 호출
    --        가능하므로 승인상태는 아예 확인하지 않는다) -> FIXED인데 code_value가 없으면
    --        30001(필수값 누락, DTO가 code_type을 몰라 걸러줄 수 없어 여기서 재검증) 순으로 처리한다.
    --        그 다음 "generation_status 1(대기)->2(진행중)" 조건부 UPDATE로 이 job을 원자적으로
    --        선점한다(status<>4도 같은 WHERE절에 포함 — 1.3 종료 캠페인 잠금). 캠페인당 코드 발급
    --        job은 1회뿐이라(05_COUPON_ISSUANCE_SCENARIO.md 1장) 이 조건부 UPDATE 자체가 동시에
    --        들어온 두 번째 발급 요청을 막는 락 역할을 겸한다 - ROW_COUNT()=0이면 이미 발급
    --        요청됐거나(생성/진행중/완료/실패 중 대기가 아님) 캠페인이 종료됐다는 뜻이라 둘 다
    --        30004로 답한다(17_CAMPAIGN_API.md 3.1 Precondition, 상세 사유 구분은 API 스펙에도
    --        없어 필요 없음).
    --        선점 이후 code_type으로 분기한다:
    --        - RANDOM(1): 여기서 할 일이 끝난다 - 실제 대량생성은 TS 서비스가 이 SP가 반환하는
    --          project_id/use_hyphen/requested_qty를 가지고 백그라운드로 수행한다(SP는 생성 루프를
    --          모른다 - nanoid는 앱 레이어 라이브러리라 SQL에서 호출할 수 없다,
    --          04_DATABASE_SCHEMA.md 6장 코드 생성 규칙 참고).
    --        - FIXED(2): 코드 1건을 즉시 INSERT한다. UNIQUE(project_id, code_value) 충돌은 이
    --          INSERT 문 범위로 좁힌 CONTINUE HANDLER FOR 1062로만 잡는다(더 일반적인 바깥
    --          EXIT HANDLER FOR SQLEXCEPTION보다 특정 조건 핸들러가 우선한다는 MySQL 규칙을
    --          이용) - 충돌 시 방금 선점한 generation_status를 1로 되돌려(재요청 가능하게) 32001을
    --          반환한다. 성공하면 generated_qty=requested_qty=1, generation_status=3(완료)까지
    --          이 SP 안에서 동기로 확정한다 - 단 이 완료 UPDATE도 `status<>4`를 조건으로 걸어,
    --          INSERT 이후 COMMIT 전 그 사이 캠페인이 종료됐으면 INSERT까지 함께 되돌리고
    --          30004를 반환한다(수정1 참고).
    --        edit_count는 건드리지 않는다 - 17_CAMPAIGN_API.md 2.4가 edit_count 대상 SP로 나열한
    --        것은 Update/ChangeStatus/Approve/Reject(2.4~2.7)뿐이고 코드 발급(3.1/3.2)은 별개
    --        축이다(coupon_campaign.sql edit_count 헤더 주석, PATCH의 WHERE절도 generation_status를
    --        보지 않으므로 상호 간섭이 없다).
    --        반환 컬럼은 API 응답 그대로가 아니라 TS 서비스가 RANDOM/FIXED 응답을 각각 조립하는 데
    --        필요한 필드(project_id/use_hyphen/requested_qty 등 백그라운드 루프용 포함)를 전부 담은
    --        슈퍼셋이다 - RANDOM 요청이면 coupon_code_id/code_value/code_status는 항상 NULL.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id     BIGINT UNSIGNED  DEFAULT NULL;
    DECLARE v_code_type      TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_duplicate      BOOLEAN          DEFAULT FALSE;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    -- FIXED 코드 INSERT 전용 - 1062(UNIQUE 위반)만 여기서 흡수하고 그 외 SQLEXCEPTION은 위 EXIT
    -- HANDLER로 넘어간다(같은 스코프에 선언돼도 더 구체적인 조건 핸들러가 우선한다는 MySQL 규칙).
    DECLARE CONTINUE HANDLER FOR 1062 SET v_duplicate = TRUE;

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id
        ) THEN
            SELECT 31004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `project_id`, `code_type` INTO v_project_id, v_code_type
        FROM `coupon_campaign` WHERE `coupon_campaign_id` = i_coupon_campaign_id;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_PROJECT_ACCESS(i_requester_user_id, v_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF v_code_type = 2 AND i_code_value IS NULL THEN
            SELECT 30001 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `coupon_campaign`
        SET `generation_status` = 2
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `generation_status` = 1
          AND `status` <> 4;

        IF ROW_COUNT() = 0 THEN
            SELECT 30004 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF v_code_type = 2 THEN
            START TRANSACTION;

            INSERT INTO `coupon_code` (`coupon_campaign_id`, `project_id`, `code_value`, `status`)
            VALUES (i_coupon_campaign_id, v_project_id, i_code_value, 1);

            IF v_duplicate THEN
                ROLLBACK;
                -- 방금 선점한 job을 되돌려 관리자가 다른 code_value로 재요청할 수 있게 한다
                -- (05_COUPON_ISSUANCE_SCENARIO.md 2.2 - FIXED는 실패해도 generation_status=1 유지).
                UPDATE `coupon_campaign` SET `generation_status` = 1
                WHERE `coupon_campaign_id` = i_coupon_campaign_id;
                SELECT 32001 AS RESULT;
                LEAVE proc_block;
            END IF;

            UPDATE `coupon_campaign`
            SET `generated_qty` = `requested_qty`, `generation_status` = 3
            WHERE `coupon_campaign_id` = i_coupon_campaign_id
              AND `status` <> 4;

            IF ROW_COUNT() = 0 THEN
                -- INSERT까지는 성공했으나 그 사이 캠페인이 종료(status=4)됨 - 완료 처리를 포기하고
                -- INSERT까지 함께 되돌린다. generation_status는 선점 당시 값(2)에 그대로 남지만
                -- 1.3이 종료된 캠페인의 모든 쓰기 API를 이미 차단하므로 무해하다
                -- (05_COUPON_ISSUANCE_SCENARIO.md 2.5와 동일한 원칙 - 억지로 되돌리지 않는다).
                ROLLBACK;
                SELECT 30004 AS RESULT;
                LEAVE proc_block;
            END IF;

            COMMIT;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            cc.`coupon_campaign_id`, cc.`project_id`, cc.`code_type`, cc.`use_hyphen`,
            cc.`requested_qty`, cc.`generated_qty`, cc.`generation_status`,
            co.`coupon_code_id`, co.`code_value`, co.`status` AS code_status
        FROM `coupon_campaign` cc
        LEFT JOIN `coupon_code` co ON co.`coupon_campaign_id` = cc.`coupon_campaign_id`
        WHERE cc.`coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;


-- ============================================================================================================ --
-- SP_CAMPAIGN_CODE_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_LIST` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_status             TINYINT UNSIGNED, -- 상태 필터 (NULL이면 전체)
    IN i_page_size          INT,              -- 페이지당 행 수
    IN i_offset             INT,              -- 시작 오프셋
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인별 쿠폰 코드 목록 조회 - 페이지네이션 (17_CAMPAIGN_API.md 3.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_LIST
    -- 작성 : 2026.07.21 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001) 순으로
    --        처리한다. 조회 전용이라 approval_status/generation_status와 무관하게 캠페인 접근
    --        권한만 있으면 볼 수 있다(SP_CAMPAIGN_GET_BY_ID와 동일한 권한 범위). total_count는
    --        SP_CAMPAIGN_LIST와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 + LEFT JOIN ...
    --        ON TRUE 패턴(02_DEV_CONVENTIONS.md 3.6). FIXED는 항상 최대 1건이라 정렬 기준이 중요치
    --        않지만, RANDOM 대량조회 편의를 위해 coupon_code_id 오름차순(생성순)으로 고정한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT UNSIGNED DEFAULT NULL;

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

        SELECT 0 AS RESULT;
        SELECT
            pg.`coupon_code_id`, pg.`code_value`, pg.`status`, pg.`created_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `coupon_code`
            WHERE `coupon_campaign_id` = i_coupon_campaign_id
              AND (i_status IS NULL OR `status` = i_status)
        ) cnt
        LEFT JOIN (
            SELECT `coupon_code_id`, `code_value`, `status`, `created_at`
            FROM `coupon_code`
            WHERE `coupon_campaign_id` = i_coupon_campaign_id
              AND (i_status IS NULL OR `status` = i_status)
            ORDER BY `coupon_code_id` ASC
            LIMIT i_page_size OFFSET i_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;


-- ============================================================================================================ --
-- SP_CAMPAIGN_CODE_RETRY
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_RETRY`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_RETRY` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '코드 생성 재시도 - generation_status 4(실패)->2(진행중) 조건부 UPDATE (17_CAMPAIGN_API.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_RETRY
    -- 작성 : 2026.07.21 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001) ->
    --        "generation_status=4(실패) AND status<>4(1.3)" 조건부 UPDATE로 원자 처리한다
    --        (05_COUPON_ISSUANCE_SCENARIO.md 2.3). ROW_COUNT()=0이면 실패 상태가 아니거나(이미
    --        완료/진행중/대기) 캠페인이 종료됐다는 뜻 - 둘 다 30004(API 스펙도 사유를 구분하지
    --        않음). FIXED는 애초에 generation_status=4에 도달하지 않으므로(동기 즉시실패 처리,
    --        05_COUPON_ISSUANCE_SCENARIO.md 2.2) 이 SP가 실질적으로 호출될 대상은 RANDOM뿐이다.
    --        이미 생성된 generated_qty는 그대로 두고 TS 서비스가 남은 수량(requested_qty -
    --        generated_qty)만 이어서 생성하므로, 그 재개에 필요한 project_id/use_hyphen/
    --        requested_qty/generated_qty를 함께 반환한다. edit_count는 SP_CAMPAIGN_CODE_ISSUE와
    --        동일한 이유로 건드리지 않는다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT UNSIGNED DEFAULT NULL;

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
        SET `generation_status` = 2
        WHERE `coupon_campaign_id` = i_coupon_campaign_id
          AND `generation_status` = 4
          AND `status` <> 4;

        IF ROW_COUNT() = 0 THEN
            SELECT 30004 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `use_hyphen`, `requested_qty`,
            `generated_qty`, `generation_status`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;


-- ============================================================================================================ --
-- SP_CAMPAIGN_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CREATE` (
    IN i_project_id        BIGINT UNSIGNED,  -- 소속 프로젝트 ID
    IN i_name               VARCHAR(100),     -- 캠페인명
    IN i_campaign_start     DATETIME,         -- 사용 가능 시작일시
    IN i_campaign_end       DATETIME,         -- 사용 가능 종료일시
    IN i_code_type          TINYINT UNSIGNED, -- 코드 발급 방식 (1:RANDOM, 2:FIXED)
    IN i_use_hyphen         TINYINT UNSIGNED, -- 하이픈 포함 여부 (RANDOM에만 적용)
    IN i_requested_qty      INT UNSIGNED,     -- 목표 수량(RANDOM: 발급할 코드 개수, FIXED: 단일 공유 코드의 총 사용가능 횟수) - RANDOM/FIXED 공통, 서버가 강제하지 않음
    IN i_use_limit_per_user INT UNSIGNED,     -- 동일 유저 재사용 허용 횟수
    IN i_reward_data        JSON,             -- 보상 내용(자유 스키마, pass-through)
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 생성 - 프로젝트 스코핑 재검증, role_code 기반 approval_status 자동결정 (17_CAMPAIGN_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CREATE
    -- 작성 : 2026.07.20 trisakion
    -- 수정1: 2026.07.22 trisakion — code_type=2(FIXED)면 requested_qty를 서버가 항상 1로
    --        강제하던 로직을 제거했다. S2S reserve 스모크 테스트에서 FIXED 코드를 서로 다른
    --        유저가 각자 독립적으로 쓸 수 있어야 한다는 06_COUPON_USAGE_SCENARIO.md 4.2 예시가
    --        실제로는 SP_CAMPAIGN_UPDATE의 `usable_qty<=generated_qty` 검증 때문에 막히는 걸
    --        발견함 — FIXED는 generated_qty가 강제로 1이라 usable_qty도 최대 1까지만 열 수
    --        있어, 첫 유저가 쓰는 순간 캠페인 전체가 소진돼버렸다. 코드 물리적 행은 여전히
    --        FIXED당 1건뿐이지만(05_COUPON_ISSUANCE_SCENARIO.md 2장 - "코드 문자열을 여러 개
    --        둘 이유가 없다"는 이유 자체는 변하지 않음), requested_qty/generated_qty를 "코드
    --        개수"가 아니라 "그 1건이 지원할 총 사용가능 횟수"로 재정의해 RANDOM과 동일하게
    --        관리자가 직접 지정하도록 바꿨다 - SP_CAMPAIGN_CODE_ISSUE의 FIXED 완료 처리도
    --        `generated_qty=requested_qty`로 맞춰 함께 수정.
    -- 내용 : 쿠폰 도메인 최초 SP. 캠페인/코드 컨트롤은 회사 단위가 아니라 항상 **프로젝트 단위**로
    --        스코핑한다(17_CAMPAIGN_API.md 1.2) — company/project/user 도메인의 "DEVELOPER는
    --        회사 전체 조회" 예외가 이 도메인에는 적용되지 않는다. SUPER_ADMIN은 FN_IS_SUPER_ADMIN
    --        으로 우회하고, 그 외 role은 FN_GET_PROJECT_ROLE_CODE(i_requester_user_id,
    --        i_project_id)로 해당 프로젝트에 실제 활성 배정된 role_code를 얻는다(NULL이면 배정
    --        자체가 없다는 뜻 -> 20001). 이렇게 얻은 role_code로 approval_status를 자동 결정한다
    --        (role_code<=30 즉 SUPER_ADMIN/DEVELOPER/MANAGER면 1:승인불요, OPERATOR(40)면
    --        2:승인대기 — 17_CAMPAIGN_API.md 2.1 Business Rules). project_id 자체의 존재 확인은
    --        FN_GET_PROJECT_ROLE_CODE가 이미 project FK를 통해 암묵적으로 검증하지만(존재하지
    --        않는 project_id는 배정도 있을 수 없음), SUPER_ADMIN 우회 경로는 이 검증을 건너뛰므로
    --        별도로 존재 확인(31002)을 먼저 한다.
    --        requested_qty는 RANDOM/FIXED 모두 호출자가 지정한 값을 그대로 저장한다(수정1 참고,
    --        05_COUPON_ISSUANCE_SCENARIO.md 2장 — FIXED에서도 "generated_qty == requested_qty
    --        -> 완료" 판정 로직을 RANDOM과 동일하게 재사용하되, 그 값 자체는 코드 개수가 아니라
    --        총 사용가능 횟수를 의미).
    --        usable_qty/generated_qty/used_qty/generation_status/generation_error는 테이블
    --        DEFAULT(0/0/0/1/NULL)를 그대로 따르므로 이 SP는 건드리지 않는다 — 코드는 아직 하나도
    --        발급되지 않았으므로 usable_qty를 0보다 크게 열어둘 이유가 없다.
    --        log_coupon_campaign(action=10 CREATE) 기록은 이 SP가 직접 하지 않는다 — 로그 DB가
    --        물리적으로 분리돼 있어(02_DEV_CONVENTIONS.md 1장) 메인 SP가 호출할 수 없으므로, 이
    --        SP가 반환하는 생성된 행 전체를 TS 서비스가 그대로 SP_LOG_COUPON_CAMPAIGN_CREATE(로그
    --        DB)에 전달한다. log_audit(before/after JSON)와 달리 log_coupon_campaign은 컬럼을
    --        그대로 복제하는 구조라(04_DATABASE_SCHEMA.md 10장) 이 SP가 별도 JSON 캡처를 할 필요가
    --        없다 — 반환 행 자체가 곧 로그에 필요한 전부다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_role            TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_approval_status TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_campaign_id     BIGINT UNSIGNED  DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SET v_role = 10;
        ELSE
            SET v_role = FN_GET_PROJECT_ROLE_CODE(i_requester_user_id, i_project_id);
            IF v_role IS NULL THEN
                SELECT 20001 AS RESULT;
                LEAVE proc_block;
            END IF;
        END IF;

        SET v_approval_status = IF(v_role <= 30, 1, 2);

        INSERT INTO `coupon_campaign` (
            `project_id`, `name`, `campaign_start`, `campaign_end`, `code_type`, `use_hyphen`,
            `requested_qty`, `use_limit_per_user`, `approval_status`, `reward_data`,
            `created_by`, `updated_by`
        ) VALUES (
            i_project_id, i_name, i_campaign_start, i_campaign_end, i_code_type, i_use_hyphen,
            i_requested_qty, i_use_limit_per_user, v_approval_status, i_reward_data,
            i_requester_user_id, i_requester_user_id
        );

        SET v_campaign_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`, `edit_count`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = v_campaign_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_CAMPAIGN_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_GET_BY_ID` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 조회할 캠페인 ID
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 단건 조회 - 미존재 31004, 스코핑 범위 밖 20001 (17_CAMPAIGN_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_GET_BY_ID
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : 존재 확인(31004) -> project_id 조회 -> 프로젝트 스코핑 재검증(20001) 순으로 처리한다.
    --        17_CAMPAIGN_API.md 1.2/2.3 — "존재하지 않음"과 "스코핑 범위 밖"을 분리해서 각각
    --        31004/20001로 응답한다(2026-07-20 문서 정정 — 이전에 2.3/4.1에 남아있던 "둘 다
    --        31004" 서술은 1.2 일반 원칙과 어긋난 오기였고, 사용자 확인 후 20001로 통일함 —
    --        company/project/user 도메인의 "스코핑 밖=20001" 선례와도 일치).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT UNSIGNED DEFAULT NULL;

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

        SELECT 0 AS RESULT;
        SELECT
            `coupon_campaign_id`, `project_id`, `name`, `campaign_start`, `campaign_end`,
            `code_type`, `use_hyphen`, `requested_qty`, `generated_qty`, `generation_status`,
            `generation_error`, `usable_qty`, `used_qty`, `use_limit_per_user`, `status`,
            `approval_status`, `approved_by`, `approved_at`, `reject_reason`, `reward_data`,
            `created_by`, `updated_by`, `created_at`, `updated_at`, `edit_count`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;


-- ============================================================================================================ --
-- SP_CAMPAIGN_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_LIST` (
    IN i_project_id        BIGINT UNSIGNED,   -- 필수 - 스코핑 기준(17_CAMPAIGN_API.md 2.2, 회사 단위 아님)
    IN i_status            TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_approval_status   TINYINT UNSIGNED,  -- 승인상태 필터 (NULL이면 전체)
    IN i_generation_status TINYINT UNSIGNED,  -- 코드 생성 진행상태 필터 (NULL이면 전체)
    IN i_code_type         TINYINT UNSIGNED,  -- 코드 발급 방식 필터 (NULL이면 전체)
    IN i_page_size         INT,               -- 페이지당 행 수
    IN i_offset            INT,               -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED    -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 목록 조회 - project_id 필수 스코핑, 페이지네이션 (17_CAMPAIGN_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_LIST
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : company/project 도메인의 목록 조회와 달리, 이 도메인은 "회사 전체 조회" 예외가 없고
    --        DEVELOPER/MANAGER/OPERATOR 전부 project_id 단위로만 스코핑한다(17_CAMPAIGN_API.md
    --        1.2). 그래서 i_project_id는 필수이며(company_id처럼 NULL 허용 아님), SUPER_ADMIN
    --        우회 후에는 FN_CHECK_PROJECT_ACCESS로 호출자가 그 프로젝트에 실제 활성 배정이
    --        있는지만 확인하면 된다(role_code 값 자체는 이 SP의 분기에 필요 없음 —
    --        FN_GET_PROJECT_ROLE_CODE가 아니라 FN_CHECK_PROJECT_ACCESS를 쓰는 이유).
    --        total_count는 SP_PROJECT_LIST와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 +
    --        LEFT JOIN ... ON TRUE 패턴으로 반환한다(02_DEV_CONVENTIONS.md 3.6).
    --        정렬은 status DESC, created_at DESC(17_CAMPAIGN_API.md 2.2 Sorting).
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

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_PROJECT_ACCESS(i_requester_user_id, i_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            pg.`coupon_campaign_id`, pg.`project_id`, pg.`name`, pg.`code_type`,
            pg.`requested_qty`, pg.`generated_qty`, pg.`generation_status`,
            pg.`usable_qty`, pg.`used_qty`, pg.`status`, pg.`approval_status`,
            pg.`campaign_start`, pg.`campaign_end`, pg.`created_at`, pg.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `coupon_campaign`
            WHERE `project_id` = i_project_id
              AND (i_status IS NULL OR `status` = i_status)
              AND (i_approval_status IS NULL OR `approval_status` = i_approval_status)
              AND (i_generation_status IS NULL OR `generation_status` = i_generation_status)
              AND (i_code_type IS NULL OR `code_type` = i_code_type)
        ) cnt
        LEFT JOIN (
            SELECT
                `coupon_campaign_id`, `project_id`, `name`, `code_type`,
                `requested_qty`, `generated_qty`, `generation_status`,
                `usable_qty`, `used_qty`, `status`, `approval_status`,
                `campaign_start`, `campaign_end`, `created_at`, `updated_at`
            FROM `coupon_campaign`
            WHERE `project_id` = i_project_id
              AND (i_status IS NULL OR `status` = i_status)
              AND (i_approval_status IS NULL OR `approval_status` = i_approval_status)
              AND (i_generation_status IS NULL OR `generation_status` = i_generation_status)
              AND (i_code_type IS NULL OR `code_type` = i_code_type)
            ORDER BY `status` DESC, `created_at` DESC
            LIMIT i_page_size OFFSET i_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;

DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_REJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_REJECT` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 반려할 캠페인 ID
    IN i_edit_count         INT UNSIGNED,     -- 낙관적 동시성 제어 토큰(2.3 조회 시 받은 edit_count 그대로)
    IN i_reject_reason      VARCHAR(500),     -- 반려 사유
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인 반려 - edit_count 낙관적 락 + OPERATOR 반려불가(20001) + approval_status 2->4 조건부 UPDATE (17_CAMPAIGN_API.md 2.7)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_REJECT
    -- 작성 : 2026.07.20 trisakion
    -- 내용 : SP_CAMPAIGN_APPROVE와 동일한 존재확인/스코핑+승인권한 재검증 패턴이며, 승인 대신
    --        반려(approval_status=4) + reject_reason 기록만 다르다(17_CAMPAIGN_API.md 2.7).
    --        반려 후 재상신은 별도 API 없이 SP_CAMPAIGN_UPDATE 호출 시 그 SP의 OPERATOR 재승인
    --        규칙에 의해 approval_status가 2(승인대기)로 자동 재전환된다(17_CAMPAIGN_API.md 2.7
    --        Business Rules).
    --        log_coupon_campaign(action=50 REJECT) 기록은 SP_CAMPAIGN_CREATE와 동일한 이유로
    --        이 SP가 직접 하지 않는다 - 반환 행 전체를 TS 서비스가
    --        SP_LOG_COUPON_CAMPAIGN_CREATE(로그 DB)에 그대로 전달한다.
    --        2026-07-20: edit_count 낙관적 락을 SP_CAMPAIGN_APPROVE와 동일한 이유로 이 SP에도
    --        적용한다(반려자가 검토한 시점의 캠페인 내용과 실제 반려 시점의 내용이 다를 수 있는
    --        문제, SP_CAMPAIGN_APPROVE 주석 참고). ROW_COUNT()=0이면 edit_count 불일치(30005)인지
    --        반려 대상 상태 자체가 아닌지(30004)를 재조회로 구분한다.
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
            `approval_status` = 4,
            `approved_by`      = i_requester_user_id,
            `approved_at`      = NOW(),
            `reject_reason`    = i_reject_reason,
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
            `created_by`, `updated_by`, `created_at`, `updated_at`, `edit_count`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_CAMPAIGN_UPDATE
-- ============================================================================================================ --
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
) COMMENT '캠페인 수정 - edit_count 낙관적 락 + status/수량/날짜 검증을 UPDATE 하나로 원자 처리 (17_CAMPAIGN_API.md 2.4)'
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
    --        파라미터에 아예 없다 - 수정 불가 필드라 애초에 받지 않는다(17_CAMPAIGN_API.md 2.4
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
            `created_by`, `updated_by`, `created_at`, `updated_at`, `edit_count`
        FROM `coupon_campaign`
        WHERE `coupon_campaign_id` = i_coupon_campaign_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_CAMPAIGN_USAGE_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_USAGE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_USAGE_LIST` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_game_user_id       VARCHAR(100),     -- 특정 유저 필터 (NULL이면 전체)
    IN i_confirmed          TINYINT UNSIGNED, -- 0=미컨슘만/1=컨펌완료만 (NULL이면 전체)
    IN i_page_size          INT,              -- 페이지당 행 수
    IN i_offset             INT,              -- 시작 오프셋
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '캠페인별 쿠폰 사용 이력 조회 - 페이지네이션 (17_CAMPAIGN_API.md 4.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_USAGE_LIST
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001) 순으로
    --        처리한다. 조회 전용이라 approval_status와 무관하게 캠페인 접근 권한만 있으면 볼 수
    --        있다(SP_CAMPAIGN_CODE_LIST와 동일한 권한 범위, 1.3에 따라 status=4 종료 캠페인도
    --        차단 안 됨 - 이 SP는 status를 아예 조건에 넣지 않는다). total_count는 SP_CAMPAIGN_LIST/
    --        SP_CAMPAIGN_CODE_LIST와 동일하게 COUNT(*) OVER()가 아니라 별도 서브쿼리 + LEFT JOIN
    --        ... ON TRUE 패턴(02_DEV_CONVENTIONS.md 3.6). code_value는 coupon_code_usage에
    --        비정규화돼 있지 않아(project_id만 비정규화됨, coupon_code_usage.sql 참고)
    --        coupon_code를 조인해서 가져온다. 정렬은 최근 이력이 먼저 보이도록 created_at DESC로
    --        고정한다(SP_LOG_AUDIT_LIST와 동일한 원칙 - 로그성 조회는 최신순).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT UNSIGNED DEFAULT NULL;

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

        SELECT 0 AS RESULT;
        SELECT
            pg.`coupon_code_usage_id`, pg.`code_value`, pg.`game_user_id`,
            pg.`confirmed_at`, pg.`created_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `coupon_code_usage`
            WHERE `coupon_campaign_id` = i_coupon_campaign_id
              AND (i_game_user_id IS NULL OR `game_user_id` = i_game_user_id)
              AND (
                    i_confirmed IS NULL
                    OR (i_confirmed = 1 AND `confirmed_at` IS NOT NULL)
                    OR (i_confirmed = 0 AND `confirmed_at` IS NULL)
                  )
        ) cnt
        LEFT JOIN (
            SELECT u.`coupon_code_usage_id`, c.`code_value`, u.`game_user_id`,
                   u.`confirmed_at`, u.`created_at`
            FROM `coupon_code_usage` u
            JOIN `coupon_code` c ON c.`coupon_code_id` = u.`coupon_code_id`
            WHERE u.`coupon_campaign_id` = i_coupon_campaign_id
              AND (i_game_user_id IS NULL OR u.`game_user_id` = i_game_user_id)
              AND (
                    i_confirmed IS NULL
                    OR (i_confirmed = 1 AND u.`confirmed_at` IS NOT NULL)
                    OR (i_confirmed = 0 AND u.`confirmed_at` IS NULL)
                  )
            ORDER BY u.`created_at` DESC
            LIMIT i_page_size OFFSET i_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_CREATE` (
    IN i_company_code      VARCHAR(20),      -- 회사 코드 (전역 UNIQUE)
    IN i_company_name      VARCHAR(100),     -- 회사명
    IN i_description       VARCHAR(1000),    -- 설명 (선택)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '회사 생성 - SUPER_ADMIN 재검증, company_code 중복 확인 후 INSERT (10_COMPANY_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 생성. company_code 중복을 사전 체크(32001)한 뒤 INSERT한다. SP_USER_SIGNUP과
    --        동일한 이유로 사전 체크는 원자적이지 않으므로(동시에 같은 code로 두 요청이 들어오면
    --        둘 다 통과할 수 있음), INSERT의 UNIQUE 제약 위반(1062) 전용 핸들러를 백스톱으로 둔다.
    --        회사 관리메뉴는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 호출자가 실제 DB상 SUPER_ADMIN인지 재확인한다(방어적 이중
    --        체크, 02_DEV_CONVENTIONS.md 3.2) - 다른 검증보다 가장 먼저 확인한다.
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 결과 SELECT에 after_json/requester_name을
    --        추가했다 - 로그 DB는 물리적으로 분리돼 있어 이 SP가 직접 기록할 수 없으므로, TS
    --        서비스가 이 값을 그대로 SP_LOG_AUDIT_CREATE(로그 DB)에 전달한다(before_json은 CREATE라
    --        NULL). requester_name은 JWT 페이로드에 user_name이 없어 여기서 user 테이블을 직접
    --        조회해 채운다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_company_id  BIGINT       DEFAULT NULL;

    -- company_code 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (SELECT 1 FROM `company` WHERE `company_code` = i_company_code) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `company` (`company_code`, `company_name`, `description`)
        VALUES (i_company_code, i_company_name, i_description);

        SET v_company_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `company_id`, `company_code`, `company_name`, `description`,
            `status`, `created_at`, `updated_at`,
            JSON_OBJECT(                    -- after_json: log_audit 스냅샷(13_LOG_AUDIT_API.md)
                'company_id', `company_id`, 'company_code', `company_code`,
                'company_name', `company_name`, 'description', `description`,
                'status', `status`, 'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `company`
        WHERE `company_id` = v_company_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_GET_ACTIVE_HEADER_DATA
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_ACTIVE_HEADER_DATA`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_ACTIVE_HEADER_DATA` (
    IN i_user_id    BIGINT UNSIGNED,  -- 요청자 user_id (JWT 페이로드 값 그대로 신뢰)
    IN i_role_code  TINYINT UNSIGNED, -- 요청자 role_code (JWT 페이로드 값 그대로 신뢰)
    IN i_company_id BIGINT UNSIGNED   -- 요청자 소속 company_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '헤더 콤보박스용 활성 회사/프로젝트 조회 (10_COMPANY_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_ACTIVE_HEADER_DATA
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인 직후 헤더 콤보박스가 1회 로드하는 활성 회사·프로젝트 목록.
    --        role_code=10(SUPER_ADMIN)이면 전체 활성 회사+프로젝트, 그 외에는 본인 소속 회사 1건과
    --        user_role에 활성 배정(status=1)된 프로젝트만 반환한다 — 같은 회사 소속이어도 role
    --        미배정 프로젝트는 제외한다(10_COMPANY_API.md 3.1 Business Rules).
    --        role_code/company_id는 JwtAuthGuard가 검증한 JWT 페이로드 값을 그대로 신뢰하고 DB를
    --        재조회하지 않는다(jwt-auth.guard.ts와 같은 원칙, 로그인/재발급 시점에만 재계산됨).
    --        02_DEV_CONVENTIONS.md 3.4의 RESULT SELECT 규약은 RESULT + data 정확히 2개 result set만
    --        허용하므로, company/project를 각각 별도 result set으로 반환하는 대신 row_type
    --        판별 컬럼('COMPANY'/'PROJECT')으로 하나의 result set에 함께 담는다 — 서비스 레이어
    --        (company.service.ts)에서 row_type으로 다시 분리해 {companies, projects} 형태로 조립한다.
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

    IF i_role_code = 10 THEN
        SELECT 'COMPANY' AS row_type, `company_id` AS id, `company_id` AS company_id, `company_name` AS name
        FROM `company`
        WHERE `status` = 1
        UNION ALL
        SELECT 'PROJECT' AS row_type, `project_id` AS id, `company_id` AS company_id, `project_name` AS name
        FROM `project`
        WHERE `status` = 1;
    ELSE
        SELECT 'COMPANY' AS row_type, `company_id` AS id, `company_id` AS company_id, `company_name` AS name
        FROM `company`
        WHERE `company_id` = i_company_id AND `status` = 1
        UNION ALL
        SELECT 'PROJECT' AS row_type, p.`project_id` AS id, p.`company_id` AS company_id, p.`project_name` AS name
        FROM `project` p
        INNER JOIN `user_role` ur ON ur.`project_id` = p.`project_id`
        WHERE ur.`user_id` = i_user_id AND ur.`status` = 1 AND p.`status` = 1;
    END IF;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_GET_BY_CODE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_BY_CODE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_BY_CODE` (
    IN i_company_code VARCHAR(20)  -- 조회할 회사 코드
) COMMENT '회사 코드로 조회 - 회원가입 화면 전용 공개 API (10_COMPANY_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_BY_CODE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회원가입 화면(로그인 전, 인증 불필요)에서 company_code로 회사를 찾기 위한 공개 조회.
    --        status=1(사용)인 회사만 대상으로 하고, company_id/company_name만 반환한다 —
    --        민감정보(description 등)는 노출하지 않는다. 없거나 비활성이면 31001.
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

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `company` WHERE `company_code` = i_company_code AND `status` = 1
        ) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `company_id`, `company_name`
        FROM `company`
        WHERE `company_code` = i_company_code AND `status` = 1;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_BY_ID` (
    IN i_company_id        BIGINT UNSIGNED,  -- 조회할 회사 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '회사 상세 조회 - SUPER_ADMIN 재검증 (10_COMPANY_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id로 회사 상세를 조회한다. 없으면 31001. 회사 관리메뉴는 SUPER_ADMIN
    --        전용이라 RolesGuard가 이미 막고 있지만, 이 SP도 FN_IS_SUPER_ADMIN으로 재확인한다
    --        (방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
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

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `company_id`, `company_code`, `company_name`, `description`,
            `status`, `created_at`, `updated_at`
        FROM `company`
        WHERE `company_id` = i_company_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_LIST` (
    IN i_status            TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_page_size         INT,               -- 페이지당 행 수
    IN i_offset            INT,               -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED    -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '회사 목록 조회 - SUPER_ADMIN 재검증, 페이지네이션 (10_COMPANY_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 목록을 status DESC, company_name ASC로 정렬해 페이지 단위로 반환한다.
    --        02_DEV_CONVENTIONS.md 3.4의 RESULT SELECT 규약은 RESULT + data 정확히 2개 result set만
    --        허용하므로, 별도의 COUNT(*) 쿼리를 셋째 result set으로 추가할 수 없다. 다만 total_count를
    --        페이지네이션 대상 SELECT에 COUNT(*) OVER()로 얹으면, 요청한 offset이 실제 데이터
    --        범위를 벗어나 0행이 반환되는 경우 total_count도 함께 사라져 0으로 잘못 응답되는
    --        문제가 있다(2026-07-19 감사에서 발견). 이를 막기 위해 총 개수를 별도 서브쿼리로 항상
    --        1행 계산해두고, 페이지네이션 서브쿼리를 LEFT JOIN ... ON TRUE로 붙인다 — 페이지네이션
    --        결과가 0행이어도 총 개수 행은 NULL 데이터 컬럼과 함께 보존된다(앱 레이어는 PK 컬럼이
    --        NULL인 행을 데이터 없음으로 취급하고 total_count만 읽는다). 페이지네이션이 필요한 다른
    --        목록 SP(project/user 등)도 이 패턴을 그대로 재사용한다.
    --        회사 관리메뉴는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 재확인한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
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

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`company_id`, p.`company_code`, p.`company_name`, p.`description`,
            p.`status`, p.`created_at`, p.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `company`
            WHERE i_status IS NULL OR `status` = i_status
        ) cnt
        LEFT JOIN (
            SELECT `company_id`, `company_code`, `company_name`, `description`, `status`, `created_at`, `updated_at`
            FROM `company`
            WHERE i_status IS NULL OR `status` = i_status
            ORDER BY `status` DESC, `company_name` ASC
            LIMIT i_page_size OFFSET i_offset
        ) p ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_UPDATE` (
    IN i_company_id        BIGINT UNSIGNED,  -- 수정할 회사 ID
    IN i_company_code      VARCHAR(20),      -- 새 회사 코드 (NULL이면 미변경)
    IN i_company_name      VARCHAR(100),     -- 새 회사명 (NULL이면 미변경)
    IN i_description       VARCHAR(1000),    -- 새 설명 (NULL이면 미변경)
    IN i_status            TINYINT UNSIGNED, -- 새 상태 (NULL이면 미변경)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '회사 수정 - SUPER_ADMIN 재검증, 조건부 UPDATE (10_COMPANY_API.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 정보 수정. 존재 확인(31001) -> company_code 변경 시 중복 확인(자기 자신 제외, 32001)
    --        -> COALESCE 기반 조건부 UPDATE(02_DEV_CONVENTIONS.md 4장)로 NULL로 넘어온 필드는 기존
    --        값을 유지한다. 관리자 폼이 매번 전체 필드를 채워 보내는 단순 CRUD라 "필드를 명시적으로
    --        NULL로 비우는" 시나리오까지는 다루지 않는다(description을 지우고 싶으면 빈 문자열을
    --        보내는 것으로 충분 — 실제 NULL 저장이 필요해지면 그때 별도 플래그를 추가한다).
    --        SP_COMPANY_CREATE와 동일한 이유로, 사전 중복확인 -> UPDATE 사이에 다른 트랜잭션이
    --        같은 company_code로 끼어드는 경쟁 상태에 대비해 UNIQUE 제약 위반(1062) 백스톱
    --        핸들러를 둔다(2026-07-19 리뷰에서 CREATE에만 있고 UPDATE에는 없던 것을 발견).
    --        회사 관리메뉴는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다 - 캡처와
    --        UPDATE 사이에 이론상 레이스 윈도우가 있지만(관리콘솔 저빈도 트래픽이라 실무 영향 미미),
    --        TS 레이어가 별도로 조회하는 방식(레이스 + user_role 등 일부 도메인은 단건 조회 SP
    --        자체가 없어 신규 필요)보다 원자적이라 이 방식을 택했다(02_DEV_CONVENTIONS.md 3.2와
    --        같은 "DB가 최종 방어선/근원" 원칙).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    -- company_code 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF i_company_code IS NOT NULL AND EXISTS (
            SELECT 1 FROM `company`
            WHERE `company_code` = i_company_code AND `company_id` <> i_company_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷(log_audit용)
            'company_id', `company_id`, 'company_code', `company_code`,
            'company_name', `company_name`, 'description', `description`,
            'status', `status`, 'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `company` WHERE `company_id` = i_company_id;

        UPDATE `company`
        SET
            `company_code` = COALESCE(i_company_code, `company_code`),
            `company_name` = COALESCE(i_company_name, `company_name`),
            `description`  = COALESCE(i_description, `description`),
            `status`       = COALESCE(i_status, `status`)
        WHERE `company_id` = i_company_id;

        SELECT 0 AS RESULT;
        SELECT
            `company_id`, `company_code`, `company_name`, `description`,
            `status`, `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'company_id', `company_id`, 'company_code', `company_code`,
                'company_name', `company_name`, 'description', `description`,
                'status', `status`, 'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `company`
        WHERE `company_id` = i_company_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COUPON_CODE_GET_BY_VALUE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COUPON_CODE_GET_BY_VALUE`;
DELIMITER $$
CREATE PROCEDURE `SP_COUPON_CODE_GET_BY_VALUE` (
    IN i_project_id BIGINT UNSIGNED,  -- S2S 인증으로 스코핑된 project_id
    IN i_code_value  VARCHAR(50)      -- 조회할 코드값
) COMMENT '프로젝트+코드값으로 coupon_code 조회 (SP_COUPON_RESERVE/CONFIRM 실패 시 log_coupon_use용 campaign_id 보강 전용)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COUPON_CODE_GET_BY_VALUE
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : SP_COUPON_RESERVE/SP_COUPON_CONFIRM은 02_DEV_CONVENTIONS.md 3.4 규약상 실패 시
    --        RESULT 단일 컬럼만 반환하므로, 코드는 존재하지만 다른 사유로 실패한 경우(RESERVE의
    --        33001/33002/33003, CONFIRM의 31006)에도 coupon_campaign_id를 알 수 없다. 하지만
    --        log_coupon_use.coupon_campaign_id는 "코드 자체가 없는 시도만 NULL"이 설계 의도라
    --        (log_coupon_use.sql 헤더 주석), TS 서비스가 이 실패 분기에서만 별도로 이 SP를
    --        호출해 campaign_id를 보강한 뒤 로그를 남긴다(성공 경로/코드없음(31005) 경로는
    --        이 SP를 호출하지 않음 - RESERVE/CONFIRM 성공 시엔 각 SP가 이미 campaign_id를
    --        함께 반환하므로 불필요). 순수 로깅 보강용이라 결과를 못 찾아도(31005) TS는 그냥
    --        campaign_id=NULL로 로그를 남기면 그만이며 에러를 전파하지 않는다.
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

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `coupon_code`
            WHERE `project_id` = i_project_id AND `code_value` = i_code_value
        ) THEN
            SELECT 31005 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `coupon_code_id`, `coupon_campaign_id`, `status`
        FROM `coupon_code`
        WHERE `project_id` = i_project_id AND `code_value` = i_code_value;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COUPON_CONFIRM
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COUPON_CONFIRM`;
DELIMITER $$
CREATE PROCEDURE `SP_COUPON_CONFIRM` (
    IN i_project_id   BIGINT UNSIGNED,  -- S2S 인증으로 스코핑된 project_id
    IN i_code_value   VARCHAR(50),      -- coupon_code.code_value
    IN i_game_user_id VARCHAR(100)      -- 게임서버 유저 식별자
) COMMENT '쿠폰 사용 지급결과 기록 - confirm (18_COUPON_USAGE_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COUPON_CONFIRM
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : 06_COUPON_USAGE_SCENARIO.md 2.1(confirm 흐름도)/2.2(중복 호출 무해)를 그대로
    --        구현한다. confirm은 coupon_code/coupon_campaign 어떤 상태도 바꾸지 않으므로(소모
    --        확정은 이미 reserve에서 끝남) 별도 락이 필요 없다 - 재시도로 두 번 호출돼도
    --        confirmed_at을 같은 값으로 다시 쓰는 것뿐이라 무해하다.
    --        1) 코드 조회(project_id+code_value) - 없으면 31005
    --        2) coupon_code_usage 조회(coupon_code_id+game_user_id 매칭) - 없으면 31006
    --           (reserve를 먼저 호출한 적 없거나, reserve 때와 다른 game_user_id로 호출한 경우)
    --        3) 이미 confirmed_at이 있으면 그대로 재반환(멱등), 없으면 조건부 UPDATE(`WHERE
    --           confirmed_at IS NULL`)로 기록 후 재조회해 반환 - 조건부 UPDATE로 감싼 것은
    --           동시 confirm 호출 시 ROW_COUNT()=0이 나더라도(=경쟁에서 짐) 에러로 취급하지
    --           않고 그냥 결과를 다시 읽어 그대로 반환하기 위함(둘 다 성공 응답을 받는 것이
    --           의도된 동작, 02_DEV_CONVENTIONS.md 4장의 "조건부 UPDATE 우선" 원칙을 따르되
    --           실패를 별도 분기로 두지 않는 경우).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_coupon_code_id     BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_coupon_campaign_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_usage_id           BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_confirmed_at       DATETIME        DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SELECT `coupon_code_id`, `coupon_campaign_id` INTO v_coupon_code_id, v_coupon_campaign_id
        FROM `coupon_code`
        WHERE `project_id` = i_project_id AND `code_value` = i_code_value;

        IF v_coupon_code_id IS NULL THEN
            SELECT 31005 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT `coupon_code_usage_id`, `confirmed_at` INTO v_usage_id, v_confirmed_at
        FROM `coupon_code_usage`
        WHERE `coupon_code_id` = v_coupon_code_id AND `game_user_id` = i_game_user_id
        LIMIT 1;

        IF v_usage_id IS NULL THEN
            SELECT 31006 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF v_confirmed_at IS NULL THEN
            UPDATE `coupon_code_usage` SET `confirmed_at` = NOW()
            WHERE `coupon_code_usage_id` = v_usage_id AND `confirmed_at` IS NULL;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `coupon_code_usage_id`, v_coupon_campaign_id AS `coupon_campaign_id`, `confirmed_at`
        FROM `coupon_code_usage`
        WHERE `coupon_code_usage_id` = v_usage_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COUPON_RESERVE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COUPON_RESERVE`;
DELIMITER $$
CREATE PROCEDURE `SP_COUPON_RESERVE` (
    IN i_project_id  BIGINT UNSIGNED,  -- S2S 인증으로 스코핑된 project_id
    IN i_code_value  VARCHAR(50),      -- coupon_code.code_value
    IN i_game_user_id VARCHAR(100)     -- 게임서버 유저 식별자
) COMMENT '쿠폰 코드 예약(=즉시 소모 확정) - reserve (18_COUPON_USAGE_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COUPON_RESERVE
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : 06_COUPON_USAGE_SCENARIO.md 2.1/2.2/2.3을 그대로 구현한다.
    --        1) 코드 조회(project_id+code_value, uk_project_code_value 활용) - 없으면 31005
    --        2) 멱등 체크(use_limit_per_user=1일 때만): (coupon_code_id, game_user_id) 매칭 기존
    --           coupon_code_usage 행이 있으면 새로 만들지 않고 그 행 그대로 RESULT=0 재반환
    --           (1.2 참고 - 재시도 응답 재현)
    --        3) code_type별 코드 잠금(락 획득 순서: 코드 -> 캠페인 -> 사용자한도, 2.3 참고):
    --           RANDOM(1): `UPDATE coupon_code SET status=2 WHERE status=1` 조건부 갱신(검증+락+
    --             확정 동시) - 0건이면 33001
    --           FIXED(2): status=1(사용중) 아니면 33001. FIXED는 코드 전체 on/off만 의미하고
    --             개별 소모를 표현하지 않으므로 락 UPDATE가 필요 없다(2.2 표 - 관리자 중지
    --             레이스는 범위 밖으로 의도적으로 미대응, 2.2 마지막 문단 참고)
    --        4) 캠페인 사용 가능 조건부 UPDATE(`used_qty=used_qty+1 WHERE used_qty<usable_qty
    --           AND status=2 AND NOW() BETWEEN campaign_start AND campaign_end`) - 0건이면 33002
    --           (여기서 처음으로 명시적 트랜잭션을 ROLLBACK - RANDOM 코드 잠금도 함께 해제됨)
    --        5) 사용자당 한도 갭락(`SELECT COUNT(*) ... FOR UPDATE`) - 초과 시 33003(ROLLBACK)
    --        6) coupon_code_usage 생성(confirmed_at=NULL) + COMMIT
    --        RANDOM 코드 잠금(3)과 이후 단계(4/5/6)를 하나의 트랜잭션으로 묶기 위해 START
    --        TRANSACTION을 코드 조회 직후(멱등 체크 이후)에 연다 - FIXED는 3단계에 UPDATE가
    --        없지만 같은 트랜잭션 안에서 4/5/6이 처리되어도 무해하다(단순 SELECT 체크 후 그대로
    --        진행).
    --        반환 컬럼(coupon_code_usage_id/coupon_campaign_id/code_value/game_user_id/
    --        reward_data/created_at)은 18_COUPON_USAGE_API.md 2.1 Response를 그대로 따른다 -
    --        TS 서비스가 이 값을 그대로 HTTP 응답으로 내보낸다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_coupon_code_id     BIGINT UNSIGNED  DEFAULT NULL;
    DECLARE v_coupon_campaign_id BIGINT UNSIGNED  DEFAULT NULL;
    DECLARE v_code_status        TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_code_type          TINYINT UNSIGNED DEFAULT NULL;
    DECLARE v_use_limit          INT UNSIGNED     DEFAULT NULL;
    DECLARE v_reward_data        JSON             DEFAULT NULL;
    DECLARE v_existing_usage_id  BIGINT UNSIGNED  DEFAULT NULL;
    DECLARE v_usage_count        INT              DEFAULT 0;
    DECLARE v_new_usage_id       BIGINT UNSIGNED  DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SELECT co.`coupon_code_id`, co.`coupon_campaign_id`, co.`status`,
               ca.`code_type`, ca.`use_limit_per_user`, ca.`reward_data`
        INTO v_coupon_code_id, v_coupon_campaign_id, v_code_status,
             v_code_type, v_use_limit, v_reward_data
        FROM `coupon_code` co
        JOIN `coupon_campaign` ca ON ca.`coupon_campaign_id` = co.`coupon_campaign_id`
        WHERE co.`project_id` = i_project_id AND co.`code_value` = i_code_value;

        IF v_coupon_code_id IS NULL THEN
            SELECT 31005 AS RESULT;
            LEAVE proc_block;
        END IF;

        -- 멱등 체크(use_limit_per_user=1일 때만, 06_COUPON_USAGE_SCENARIO.md 1.2)
        IF v_use_limit = 1 THEN
            SELECT `coupon_code_usage_id` INTO v_existing_usage_id
            FROM `coupon_code_usage`
            WHERE `coupon_code_id` = v_coupon_code_id AND `game_user_id` = i_game_user_id
            LIMIT 1;

            IF v_existing_usage_id IS NOT NULL THEN
                SELECT 0 AS RESULT;
                SELECT `coupon_code_usage_id`, v_coupon_campaign_id AS `coupon_campaign_id`,
                       i_code_value AS `code_value`, `game_user_id`, v_reward_data AS `reward_data`,
                       `created_at`
                FROM `coupon_code_usage`
                WHERE `coupon_code_usage_id` = v_existing_usage_id;
                LEAVE proc_block;
            END IF;
        END IF;

        START TRANSACTION;

        IF v_code_type = 1 THEN
            UPDATE `coupon_code` SET `status` = 2
            WHERE `coupon_code_id` = v_coupon_code_id AND `status` = 1;

            IF ROW_COUNT() = 0 THEN
                ROLLBACK;
                SELECT 33001 AS RESULT;
                LEAVE proc_block;
            END IF;
        ELSE
            IF v_code_status <> 1 THEN
                ROLLBACK;
                SELECT 33001 AS RESULT;
                LEAVE proc_block;
            END IF;
        END IF;

        UPDATE `coupon_campaign`
        SET `used_qty` = `used_qty` + 1
        WHERE `coupon_campaign_id` = v_coupon_campaign_id
          AND `used_qty` < `usable_qty`
          AND `status` = 2
          AND NOW() BETWEEN `campaign_start` AND `campaign_end`;

        IF ROW_COUNT() = 0 THEN
            ROLLBACK;
            SELECT 33002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT COUNT(*) INTO v_usage_count
        FROM `coupon_code_usage`
        WHERE `coupon_campaign_id` = v_coupon_campaign_id AND `game_user_id` = i_game_user_id
        FOR UPDATE;

        IF v_usage_count >= v_use_limit THEN
            ROLLBACK;
            SELECT 33003 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `coupon_code_usage`
            (`coupon_code_id`, `coupon_campaign_id`, `project_id`, `game_user_id`, `confirmed_at`)
        VALUES
            (v_coupon_code_id, v_coupon_campaign_id, i_project_id, i_game_user_id, NULL);

        SET v_new_usage_id = LAST_INSERT_ID();

        COMMIT;

        SELECT 0 AS RESULT;
        SELECT `coupon_code_usage_id`, v_coupon_campaign_id AS `coupon_campaign_id`,
               i_code_value AS `code_value`, `game_user_id`, v_reward_data AS `reward_data`,
               `created_at`
        FROM `coupon_code_usage`
        WHERE `coupon_code_usage_id` = v_new_usage_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COUPON_UNCONFIRMED_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COUPON_UNCONFIRMED_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_COUPON_UNCONFIRMED_LIST` (
    IN i_project_id  BIGINT UNSIGNED,  -- S2S 인증으로 스코핑된 project_id
    IN i_game_user_id VARCHAR(100),    -- 지정 시 특정유저 조회 모드(NULL이면 전체유저 조회)
    IN i_campaign_id BIGINT UNSIGNED,  -- 두 모드 공통 선택 필터 (NULL이면 전체)
    IN i_page_size   INT,              -- 전체유저 조회 모드에서만 사용(특정유저 모드면 NULL)
    IN i_offset      INT               -- 전체유저 조회 모드에서만 사용(특정유저 모드면 NULL)
) COMMENT '미컨슘(confirm 안 된) 쿠폰 사용 조회 - 특정유저 전체반환/전체유저 페이지네이션 (18_COUPON_USAGE_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COUPON_UNCONFIRMED_LIST
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : 06_COUPON_USAGE_SCENARIO.md 3장 - 두 모드(특정유저/전체유저) 모두 실제 쿼리는
    --        coupon_code_usage.project_id(비정규화 컬럼) 기준으로 스코핑하고 confirmed_at IS
    --        NULL 조건은 공통이다. game_user_id만으로 조회하는 특정유저 모드도 project_id로
    --        함께 스코핑해 다른 프로젝트의 동일 game_user_id 데이터가 섞이지 않는다(3.2 참고).
    --        i_page_size/i_offset이 NULL이면(특정유저 모드) LIMIT을 사실상 무제한으로 취급하는
    --        v_effective_limit(MySQL BIGINT UNSIGNED 최댓값)을 써서, 페이지네이션 유무와
    --        무관하게 하나의 쿼리 경로(총 개수 서브쿼리 + LEFT JOIN ... ON TRUE, 02_DEV_
    --        CONVENTIONS.md 3.6)를 그대로 재사용한다 - 특정유저 모드에서 total_count는 TS가
    --        응답 조립 시 그냥 버린다(3.1 Response에 없는 필드).
    --        code_value/reward_data는 coupon_code_usage에 비정규화돼 있지 않아 coupon_code/
    --        coupon_campaign을 조인해서 가져온다. 정렬은 게임서버가 오래된 미지급 건부터
    --        재처리하기 유리하도록 created_at ASC로 고정한다(오래된 순).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_effective_limit  BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_effective_offset BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SET v_effective_limit = IF(i_page_size IS NULL, 18446744073709551615, i_page_size);
        SET v_effective_offset = IF(i_offset IS NULL, 0, i_offset);

        SELECT 0 AS RESULT;
        SELECT
            pg.`code_value`, pg.`game_user_id`, pg.`coupon_campaign_id`,
            pg.`reward_data`, pg.`created_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `coupon_code_usage`
            WHERE `project_id` = i_project_id
              AND `confirmed_at` IS NULL
              AND (i_game_user_id IS NULL OR `game_user_id` = i_game_user_id)
              AND (i_campaign_id IS NULL OR `coupon_campaign_id` = i_campaign_id)
        ) cnt
        LEFT JOIN (
            SELECT co.`code_value`, ccu.`game_user_id`, ccu.`coupon_campaign_id`,
                   ca.`reward_data`, ccu.`created_at`
            FROM `coupon_code_usage` ccu
            JOIN `coupon_code` co ON co.`coupon_code_id` = ccu.`coupon_code_id`
            JOIN `coupon_campaign` ca ON ca.`coupon_campaign_id` = ccu.`coupon_campaign_id`
            WHERE ccu.`project_id` = i_project_id
              AND ccu.`confirmed_at` IS NULL
              AND (i_game_user_id IS NULL OR ccu.`game_user_id` = i_game_user_id)
              AND (i_campaign_id IS NULL OR ccu.`coupon_campaign_id` = i_campaign_id)
            ORDER BY ccu.`created_at` ASC
            LIMIT v_effective_limit OFFSET v_effective_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_NONCE_INSERT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_NONCE_INSERT`;
DELIMITER $$
CREATE PROCEDURE `SP_NONCE_INSERT` (
    IN i_project_id BIGINT UNSIGNED,  -- 인증된 project_id (project.project_id)
    IN i_nonce      VARCHAR(64)       -- X-API-Nonce 헤더 원문
) COMMENT 'S2S nonce 원자적 등록 — UNIQUE 위반이면 재전송으로 판단해 10015 반환(docs/07_AUTH_SECURITY.md 2.4 6번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_NONCE_INSERT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : S2S 인증 가드(docs/07_AUTH_SECURITY.md 2.4 6번)의 재전송 방지 nonce 등록.
    --        (project_id, nonce) UNIQUE 제약 위반을 "이미 사용된 nonce(재전송 의심)"으로 판단해 10015를
    --        반환한다. 02_DEV_CONVENTIONS.md 3.4는 "예측 가능한 실패는 예외로 던지지 않는다"는 원칙이지만
    --        이 SP는 의도적 예외다 — INSERT 자체의 원자적 유니크 제약 위반을 이용해야만 동시에 같은 nonce가
    --        들어와도 정확히 하나만 성공시킬 수 있다(체크 후 INSERT는 두 요청이 동시에 통과하는 경쟁 상태를
    --        막지 못함, docs/07_AUTH_SECURITY.md 2.5 참고).
    --        MySQL은 여러 핸들러가 매치될 때 선언 순서와 무관하게 더 구체적인 조건(mysql_errno)을
    --        SQLEXCEPTION 같은 범용 조건보다 우선 적용하므로, 1062 전용 핸들러가 항상 먼저 걸린다 —
    --        아래에서 먼저 선언한 것은 가독성을 위한 것일 뿐, 동작상 필수는 아니다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    -- 유니크 제약(재전송) 전용 핸들러 — mysql_errno 1062(ER_DUP_ENTRY)
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 10015 AS RESULT;
    END;

    -- 그 외 예측 못한 시스템 오류
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    INSERT INTO `project_api_nonce` (`project_id`, `nonce`)
    VALUES (i_project_id, i_nonce);

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_API_SECRET_CLEANUP
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_API_SECRET_CLEANUP`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_API_SECRET_CLEANUP` (
    IN i_grace_period_days INT UNSIGNED  -- 유예기간(일) — API_SECRET_GRACE_PERIOD_DAYS
) COMMENT '유예기간 지난 api_secret_prev 정리 배치 (07_AUTH_SECURITY.md 2.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_API_SECRET_CLEANUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : Secret Rotation Grace Period 방식(07_AUTH_SECURITY.md 2.6)의 정리 배치.
    --        secret_rotated_at + i_grace_period_days가 지난 행의 api_secret_prev를 NULL
    --        처리한다 — 그 이후에는 이전 Secret으로 서명해도 더 이상 통과시키지 않는다
    --        (S2sAuthGuard.verifySignature가 api_secret_prev가 NULL이면 아예 후보에서 제외).
    --        SP_SESSION_CLEANUP과 동일하게 서버 기동 시 ApiSecretCleanupService가 크론으로 호출한다.
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

    UPDATE `project`
    SET `api_secret_prev` = NULL
    WHERE `api_secret_prev` IS NOT NULL
      AND `secret_rotated_at` IS NOT NULL
      AND `secret_rotated_at` <= NOW() - INTERVAL i_grace_period_days DAY;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_API_SECRET_ROTATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_API_SECRET_ROTATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_API_SECRET_ROTATE` (
    IN i_project_id      BIGINT UNSIGNED,  -- 재발급 대상 프로젝트 ID
    IN i_edit_count      INT UNSIGNED,     -- 낙관적 동시성 제어 토큰(2.3 조회 시 받은 edit_count 그대로)
    IN i_user_id         BIGINT UNSIGNED,  -- 요청자 user_id (JWT 페이로드 값 그대로 신뢰)
    IN i_new_api_secret_enc VARCHAR(255)   -- 새 API Secret AES-256-CBC 암호화값 (앱 레이어에서 암호화 완료)
) COMMENT 'API Secret 재발급 - Grace Period 방식 + edit_count 낙관적 락 (11_PROJECT_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_API_SECRET_ROTATE
    -- 작성 : 2026.07.19 trisakion
    -- 수정1: 2026.07.21 trisakion — 리뷰에서 이 UPDATE에 버전 체크가 전혀 없다는 걸 발견함. 더블
    --        클릭이나 타임아웃 후 재시도로 거의 동시에 두 번 재발급되면, api_secret_prev 슬롯이
    --        하나뿐이라 첫 번째 재발급이 만든 grace-period 값을 두 번째가 곧바로 덮어써 원래
    --        시크릿(S0)이 흔적도 없이 사라지는 문제가 있었다(아직 S0로 서명 중인 게임서버가
    --        있었다면 grace period가 예고 없이 조기 종료됨). "재발급 자체를 언제까지 막을지"를
    --        시간(grace period 경과)으로 판단하는 방식도 검토했으나, 그건 "지금 이 행위를 해도
    --        되는 시점인가"라는 별개의 정책 질문이고, 정작 이 버그가 실제로 묻는 질문은
    --        "호출자가 최신 상태를 보고 요청한 게 맞는가"(concurrency)라 `coupon_campaign.edit_count`
    --        와 동일한 낙관적 락으로 해결한다(project.sql 헤더 주석 참고) — 더블클릭/재시도는 항상
    --        같은(오래된) edit_count를 들고 오므로 두 번째 요청이 정확히 충돌(30005)로 걸러진다.
    --        내용 : 존재 확인(31002) 후, FN_IS_SUPER_ADMIN(i_user_id)이 아니면 FN_CHECK_PROJECT_ACCESS로
    --        해당 project_id에 실제 활성 user_role 배정이 있는지 재검증한다(11_PROJECT_API.md 2.5
    --        Business Rules — JWT의 role_code는 여러 프로젝트 중 최고 권한 하나뿐이라 이 project_id
    --        기준으로는 다시 확인해야 함). 원래는 앱이 전달한 i_role_code로 SUPER_ADMIN 우회를
    --        판단했으나, 02_DEV_CONVENTIONS.md 3.2 정책(SP는 호출자의 role_code 값을 앱으로부터
    --        전달받아 신뢰하지 않는다) 전면 적용 때 이 SP만 누락돼 있던 것을 2026-07-19 감사에서
    --        발견해 FN_IS_SUPER_ADMIN 재확인으로 교체했다(API Secret 재발급은 보안 민감 기능이라
    --        다른 SP보다 오히려 더 엄격해야 함). 통과하면 기존 api_secret을 api_secret_prev로 옮기고
    --        신규 값을 api_secret에 저장, secret_rotated_at을 갱신한다(07_AUTH_SECURITY.md 2.6
    --        Grace Period 방식). api_key는 변경하지 않는다. 반환 컬럼에 api_secret(암호문)은
    --        포함하지 않는다 — 평문은 앱 레이어가 자신이 생성한 값을 응답에 직접 얹는다.
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 company_id/project_name(스코핑/표시명용)과
    --        before_json/after_json/requester_name을 추가했다. api_secret/api_secret_prev는
    --        '***'로 마스킹한다(13_LOG_AUDIT_API.md 2.4).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT FN_IS_SUPER_ADMIN(i_user_id) AND NOT FN_CHECK_PROJECT_ACCESS(i_user_id, i_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷(api_secret류 마스킹)
            'project_id', `project_id`, 'company_id', `company_id`,
            'project_code', `project_code`, 'project_name', `project_name`,
            'description', `description`, 'api_key', `api_key`,
            'api_secret', '***',
            'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
            'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `project` WHERE `project_id` = i_project_id;

        UPDATE `project`
        SET
            `api_secret_prev`   = `api_secret`,
            `api_secret`        = i_new_api_secret_enc,
            `secret_rotated_at` = NOW(),
            `edit_count`        = `edit_count` + 1
        WHERE `project_id` = i_project_id
          AND `edit_count` = i_edit_count;

        IF ROW_COUNT() = 0 THEN
            SELECT 30005 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `project_id`, `company_id`, `project_name`, `secret_rotated_at`, `edit_count`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'project_id', `project_id`, 'company_id', `company_id`,
                'project_code', `project_code`, 'project_name', `project_name`,
                'description', `description`, 'api_key', `api_key`,
                'api_secret', '***',
                'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
                'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_user_id) AS requester_name
        FROM `project`
        WHERE `project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_CREATE` (
    IN i_company_id        BIGINT UNSIGNED,  -- 소속 회사 ID
    IN i_project_code      VARCHAR(20),      -- 프로젝트 코드 (company_id 범위 내 UNIQUE)
    IN i_project_name      VARCHAR(100),     -- 프로젝트명
    IN i_description       VARCHAR(1000),    -- 설명 (선택)
    IN i_api_key           VARCHAR(64),      -- 서버간 호출용 API Key (앱 레이어에서 생성)
    IN i_api_secret_enc    VARCHAR(255),     -- API Secret AES-256-CBC 암호화값 (앱 레이어에서 암호화 완료)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 생성 - SUPER_ADMIN 재검증, api_key/api_secret 발급 후 INSERT (11_PROJECT_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 생성. company_id 존재(31001) 확인 후 company_id 범위 내 project_code
    --        중복(32001)을 사전 체크한 뒤 INSERT한다. api_key/api_secret은 이미 앱 레이어
    --        (ProjectService)에서 생성/암호화가 끝난 값을 그대로 저장한다 — SP는 암호화 로직을
    --        모른다(SP_USER_SIGNUP과 동일한 원칙). 사전 체크는 원자적이지 않으므로 INSERT의
    --        UNIQUE 제약 위반(1062, project_code 또는 api_key 어느 쪽이든)도 32001로 통일해
    --        백스톱한다 — api_key는 256비트 난수라 충돌 가능성이 사실상 0에 가까워 별도 코드로
    --        구분하지 않는다.
    --        반환 컬럼에 api_secret(암호문)은 포함하지 않는다 — 앱으로 다시 내보낼 이유가 없고,
    --        평문은 서비스 레이어가 자신이 생성한 값을 응답에 직접 얹는다.
    --        프로젝트 생성은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 결과 SELECT에 after_json/requester_name을
    --        추가했다(before_json은 CREATE라 NULL). after_json 안의 api_secret/api_secret_prev는
    --        암호문이라도 ENCRYPTION_KEY 유출 시 복호화가 가능해 password_hash와 동일 수준으로
    --        '***' 마스킹한다(13_LOG_AUDIT_API.md 2.4).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT       DEFAULT NULL;

    -- project_code/api_key 유니크 제약 위반(경쟁 상태 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (
            SELECT 1 FROM `project`
            WHERE `company_id` = i_company_id AND `project_code` = i_project_code
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `project` (
            `company_id`, `project_code`, `project_name`, `description`, `api_key`, `api_secret`
        ) VALUES (
            i_company_id, i_project_code, i_project_name, i_description, i_api_key, i_api_secret_enc
        );

        SET v_project_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `project_id`, `company_id`, `project_code`, `project_name`, `description`,
            `api_key`, `status`, `created_at`, `updated_at`, `edit_count`,
            JSON_OBJECT(                    -- after_json: log_audit 스냅샷(api_secret류 마스킹)
                'project_id', `project_id`, 'company_id', `company_id`,
                'project_code', `project_code`, 'project_name', `project_name`,
                'description', `description`, 'api_key', `api_key`,
                'api_secret', '***',
                'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
                'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `project`
        WHERE `project_id` = v_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_GET_BY_API_KEY
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_API_KEY`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_API_KEY` (
    IN i_api_key VARCHAR(64)  -- 조회할 API Key (project.api_key)
) COMMENT 'API Key로 project 조회 (S2S 인증 가드 전용, docs/07_AUTH_SECURITY.md 2.4 3~4번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_API_KEY
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : S2S 인증 가드(docs/07_AUTH_SECURITY.md 2.4 3~4번)가 X-API-Key로 project를 조회할 때 사용.
    --        RESULT SELECT 규약(docs/02_DEV_CONVENTIONS.md 3.4)을 따른다 — 첫 SELECT는 RESULT 단일 행,
    --        성공(0)일 때만 두 번째 SELECT로 project 행(암호화된 api_secret/api_secret_prev 포함)을 반환한다.
    --        프로젝트 상태(status=0 중지)는 이 SP에서 판단하지 않는다 — "코드 없음(31002)"과
    --        "상태 불가(10014)"는 서로 다른 result 코드라, 조회 자체는 그대로 성공시키고 상태 확인은
    --        가드 쪽에서 조회된 값을 보고 별도로 매핑한다.
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

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `api_key` = i_api_key) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `project_id`,
            `status`,
            `api_secret`,
            `api_secret_prev`,
            `secret_rotated_at`
        FROM `project`
        WHERE `api_key` = i_api_key;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_GET_BY_CODE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_CODE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_CODE` (
    IN i_company_id   BIGINT UNSIGNED,  -- 조회할 회사 ID
    IN i_project_code VARCHAR(20)       -- 조회할 프로젝트 코드
) COMMENT '회사 범위 내 프로젝트 코드로 조회 - 회원가입 화면 전용 공개 API (11_PROJECT_API.md 2.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_CODE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회원가입 화면(로그인 전, 인증 불필요)에서 (company_id, project_code)로 프로젝트를
    --        찾기 위한 공개 조회. status=1(사용)인 것만 대상으로 하고, project_id/project_name만
    --        반환한다(민감정보 없음). 없거나 비활성이면 31002.
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

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `project`
            WHERE `company_id` = i_company_id AND `project_code` = i_project_code AND `status` = 1
        ) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `project_id`, `project_name`
        FROM `project`
        WHERE `company_id` = i_company_id AND `project_code` = i_project_code AND `status` = 1;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_ID` (
    IN i_project_id        BIGINT UNSIGNED,  -- 조회할 프로젝트 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 상세 조회 - company 조인, 회사 접근 재검증 (11_PROJECT_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : project_id로 프로젝트 상세를 조회한다. company_code/company_name을 함께 반환하기
    --        위해 company를 조인한다. 없으면 31002. DEVELOPER의 타사 프로젝트 접근 차단(20001)은
    --        앱 레이어(ProjectService)가 조회 결과의 company_id를 요청자의 companyId와 비교해
    --        1차로 판단하고, 이 SP도 FN_CHECK_COMPANY_ACCESS로 호출자가 실제 그 프로젝트의 회사
    --        소속인지 2차로 재검증한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2). 존재 확인이
    --        먼저이고(31002), 그 다음 접근 재검증(20001) 순서다 - 없는 리소스는 권한 여부와
    --        무관하게 항상 404가 맞다. SUPER_ADMIN 우회는 FN_IS_SUPER_ADMIN(i_requester_user_id)로
    --        SP가 직접 DB에서 재확인한다 - 앱이 넘긴 role_code 값을 그대로 믿지 않는다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_company_id  BIGINT UNSIGNED DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SELECT `company_id` INTO v_company_id FROM `project` WHERE `project_id` = i_project_id;

        IF v_company_id IS NULL THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_COMPANY_ACCESS(i_requester_user_id, v_company_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
            p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
            p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`, p.`edit_count`
        FROM `project` p
        JOIN `company` c ON c.`company_id` = p.`company_id`
        WHERE p.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_LIST` (
    IN i_company_id        BIGINT UNSIGNED,   -- 회사 필터 (NULL이면 전체 — DEVELOPER 호출 시 앱 레이어가 자기 회사로 강제)
    IN i_status            TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_page_size         INT,               -- 페이지당 행 수
    IN i_offset            INT,               -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED    -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 목록 조회 - 페이지네이션, company 조인, 회사 접근 재검증 (11_PROJECT_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 목록을 status DESC, project_name ASC로 정렬해 페이지 단위로 반환한다.
    --        company_code/company_name을 함께 보여줘야 해서 company를 조인한다. DEVELOPER는
    --        본인 소속 company_id만 봐야 하는데(11_PROJECT_API.md 2.2 Business Rules), 그 스코핑은
    --        앱 레이어(ProjectService)가 i_company_id에 항상 자기 companyId를 채워 호출하는
    --        방식으로 1차 강제하고, 이 SP도 FN_CHECK_COMPANY_ACCESS로 호출자가 실제 그 회사
    --        소속인지 2차로 재검증한다(앱 레이어 버그로 잘못된 company_id가 넘어와도 SP가
    --        마지막 방어선 역할을 하도록, 02_DEV_CONVENTIONS.md 3.2). SUPER_ADMIN 우회는
    --        FN_IS_SUPER_ADMIN(i_requester_user_id)로 SP가 직접 DB에서 재확인한다 - 앱이
    --        role_code 값을 함께 넘겨 그 값을 그대로 믿는 방식은 쓰지 않는다(앱 레이어가 잘못된
    --        role_code를 실어 보내는 버그가 있어도 이 SP는 영향받지 않는다).
    --        total_count는 SP_COMPANY_LIST와 동일한 이유로 COUNT(*) OVER()가 아니라 별도 서브쿼리
    --        + LEFT JOIN ... ON TRUE 패턴으로 반환한다(offset이 범위를 벗어나 0행이 반환돼도
    --        total_count가 0으로 사라지지 않도록, 2026-07-19 감사에서 발견된 버그 수정).
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

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_COMPANY_ACCESS(i_requester_user_id, i_company_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            pg.`project_id`, pg.`company_id`, pg.`company_code`, pg.`company_name`,
            pg.`project_code`, pg.`project_name`, pg.`api_key`, pg.`description`,
            pg.`status`, pg.`secret_rotated_at`, pg.`created_at`, pg.`updated_at`, pg.`edit_count`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `project` p
            WHERE (i_company_id IS NULL OR p.`company_id` = i_company_id)
              AND (i_status IS NULL OR p.`status` = i_status)
        ) cnt
        LEFT JOIN (
            SELECT
                p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
                p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
                p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`, p.`edit_count`
            FROM `project` p
            JOIN `company` c ON c.`company_id` = p.`company_id`
            WHERE (i_company_id IS NULL OR p.`company_id` = i_company_id)
              AND (i_status IS NULL OR p.`status` = i_status)
            ORDER BY p.`status` DESC, p.`project_name` ASC
            LIMIT i_page_size OFFSET i_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_UPDATE` (
    IN i_project_id        BIGINT UNSIGNED,  -- 수정할 프로젝트 ID
    IN i_edit_count        INT UNSIGNED,     -- 낙관적 동시성 제어 토큰(2.3 조회 시 받은 edit_count 그대로)
    IN i_project_name      VARCHAR(100),     -- 새 프로젝트명 (NULL이면 미변경)
    IN i_description       VARCHAR(1000),    -- 새 설명 (NULL이면 미변경)
    IN i_status            TINYINT UNSIGNED, -- 새 상태 (NULL이면 미변경)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 수정 - SUPER_ADMIN 재검증, edit_count 낙관적 락 + 조건부 UPDATE (11_PROJECT_API.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 수정1: 2026.07.21 trisakion — 리뷰에서 이 SP가 버전 체크 없는 순수 last-write-wins라는 걸
    --        발견함(두 관리자가 거의 동시에 수정하면 늦게 커밋된 쪽이 먼저 커밋된 변경을 조용히
    --        덮어씀). `coupon_campaign.edit_count`와 동일한 방식으로 `project.edit_count`를
    --        도입 — WHERE절에 `edit_count = i_edit_count`를 추가하고 성공 시 +1, 불일치하면
    --        ROW_COUNT()=0으로 감지해 30005(동시 수정 충돌)를 반환한다(project.sql 헤더 주석 참고).
    -- 내용 : 프로젝트 정보 수정. company_id/project_code/api_key/api_secret은 이 SP의 파라미터에
    --        아예 없다 — 생성 후 변경 불가 필드라 애초에 받지 않는다(11_PROJECT_API.md 2.4
    --        Non-Updatable Fields). 존재 확인(31002) -> COALESCE 기반 조건부 UPDATE
    --        (02_DEV_CONVENTIONS.md 4장)로 NULL로 넘어온 필드는 기존 값을 유지한다.
    --        프로젝트 수정은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다.
    --        api_secret/api_secret_prev는 이 SP가 건드리지 않는 필드지만 "전체 Row" 스냅샷
    --        원칙(13_LOG_AUDIT_API.md 2.3)상 JSON에 포함하고 '***'로 마스킹한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷(api_secret류 마스킹)
            'project_id', `project_id`, 'company_id', `company_id`,
            'project_code', `project_code`, 'project_name', `project_name`,
            'description', `description`, 'api_key', `api_key`,
            'api_secret', '***',
            'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
            'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `project` WHERE `project_id` = i_project_id;

        UPDATE `project`
        SET
            `project_name` = COALESCE(i_project_name, `project_name`),
            `description`  = COALESCE(i_description, `description`),
            `status`       = COALESCE(i_status, `status`),
            `edit_count`   = `edit_count` + 1
        WHERE `project_id` = i_project_id
          AND `edit_count` = i_edit_count;

        IF ROW_COUNT() = 0 THEN
            SELECT 30005 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
            p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
            p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`, p.`edit_count`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'project_id', p.`project_id`, 'company_id', p.`company_id`,
                'project_code', p.`project_code`, 'project_name', p.`project_name`,
                'description', p.`description`, 'api_key', p.`api_key`,
                'api_secret', '***',
                'api_secret_prev', IF(p.`api_secret_prev` IS NULL, NULL, '***'),
                'secret_rotated_at', p.`secret_rotated_at`, 'status', p.`status`,
                'created_at', p.`created_at`, 'updated_at', p.`updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `project` p
        JOIN `company` c ON c.`company_id` = p.`company_id`
        WHERE p.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_SESSION_CLEANUP
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_SESSION_CLEANUP`;
DELIMITER $$
CREATE PROCEDURE `SP_SESSION_CLEANUP` () COMMENT '만료 세션 물리 삭제 배치 (08_API_COMMON.md 5.4, SESSION_CLEANUP_CRON)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_SESSION_CLEANUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : expired_at이 현재 시각보다 과거인 세션을 status와 무관하게 물리 삭제한다.
    --        만료 기간 값(JWT_REFRESH_EXPIRES_IN) 자체를 몰라도 되도록 expired_at은 로그인 시점에
    --        이미 절대시각으로 저장돼 있어(SP_USER_SESSION_CREATE), NOW()와 비교만 하면 된다.
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

    DELETE FROM `user_session` WHERE `expired_at` < NOW();

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_APPROVE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_APPROVE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_APPROVE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 승인할 사용자 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '가입승인 - SUPER_ADMIN 재검증, status 0(대기) -> 1(승인) 조건부 UPDATE (12_USER_API.md 1.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_APPROVE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 조건부 UPDATE(WHERE status=0)를 먼저 시도해 체크 후 갱신(check-then-act) 대신
    --        원자적으로 처리한다(02_DEV_CONVENTIONS.md 4장). 영향받은 행이 0건일 때만 그 이유를
    --        진단한다 - 사용자 자체가 없으면 31003, 있는데 이미 status=0이 아니면(이미 처리됨)
    --        30004(상태 전이 불가)로 구분한다. 이렇게 하면 성공 경로(가장 흔한 경우)는 존재
    --        여부를 별도로 조회하지 않고 UPDATE 한 번으로 끝난다.
    --        가입승인은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고(대상이 없으면 SELECT...INTO가 조용히 NULL을 남길 뿐이라 안전 — 이후
    --        ROW_COUNT()=0 분기에서 어차피 LEAVE한다), 결과 SELECT에
    --        before_json/after_json/requester_name을 추가했다. password_hash는 '***'로 마스킹한다
    --        (13_LOG_AUDIT_API.md 2.4).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user` WHERE `user_id` = i_user_id;

        UPDATE `user`
        SET `status` = 1
        WHERE `user_id` = i_user_id AND `status` = 0;

        IF ROW_COUNT() = 0 THEN
            IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
                SELECT 31003 AS RESULT;
            ELSE
                SELECT 30004 AS RESULT;
            END IF;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', `user_id`, 'company_id', `company_id`,
                'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
                'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
                'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
                'status', `status`, 'last_login_at', `last_login_at`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_GET_BY_ID` (
    IN i_user_id           BIGINT UNSIGNED,  -- 조회할 사용자 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_id로 전체 컬럼 조회, 회사 접근 재검증 - GET /auth/me, 비밀번호 변경 시 현재 해시 조회, 관리자 상세조회 공용'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : GET /auth/me, PATCH /auth/password(현재 비밀번호 검증용 해시 조회), 관리자용
    --        GET /users/{user_id}(12_USER_API.md 1.3) 세 곳에서 공용으로 쓰는 조회 SP.
    --        password_hash를 포함해 전체 컬럼을 그대로 반환하며, API 응답에 어떤 필드를 노출할지
    --        (예: password_hash 제외, phone_number 복호화)는 서비스 레이어가 결정한다.
    --        i_requester_user_id는 자기 정보 조회(auth.service.ts)에서는 항상 i_user_id와 동일한
    --        값이 들어와 FN_CHECK_COMPANY_ACCESS가 자기 자신의 company_id와 비교하게 되므로
    --        결과적으로 항상 통과한다 - 자기 정보는 role과 무관하게 항상 볼 수 있어야 하므로 이는
    --        의도된 동작이다. 관리자 조회(user.service.ts)에서는 실제 호출자와 다른 대상 user_id가
    --        들어와, DEVELOPER가 타사 사용자를 조회하면 20001로 차단한다(12_USER_API.md 1.3,
    --        앱 레이어의 1차 체크를 SP가 2차로 재검증 - 02_DEV_CONVENTIONS.md 3.2). 존재 확인
    --        (31003)이 접근 재검증보다 먼저다 - 없는 리소스는 권한 여부와 무관하게 항상 404가
    --        맞다. SUPER_ADMIN 우회는 FN_IS_SUPER_ADMIN(i_requester_user_id)로 SP가 직접 DB에서
    --        재확인한다 - 앱이 role_code 값을 별도로 넘겨 그 값을 믿는 방식은 쓰지 않는다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_company_id  BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SELECT `company_id` INTO v_company_id FROM `user` WHERE `user_id` = i_user_id;

        IF v_company_id IS NULL THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_COMPANY_ACCESS(i_requester_user_id, v_company_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `password_hash`,
            `user_name`, `email`, `phone_number`, `department`, `position`, `status`,
            `last_login_at`, `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_GET_BY_LOGIN_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_GET_BY_LOGIN_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_GET_BY_LOGIN_ID` (
    IN i_login_id VARCHAR(100)  -- 로그인 ID
) COMMENT '로그인 처리 전용 - login_id로 user 조회, role_code(MIN, 미배정시 40)까지 함께 계산'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_GET_BY_LOGIN_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인(POST /auth/login) 처리용 사용자 조회. password_hash를 포함해 반환하므로
    --        앱 레이어가 bcrypt로 비교한다(SP는 비밀번호 검증 로직을 모른다).
    --        role_code는 user_session에 저장하지 않고 이 시점에 user_role을 조인해 계산한다
    --        (09_AUTH_API.md 7장 — 로그인/재발급 시점마다 동일한 방식으로 매번 재계산).
    --        login_id 자체가 없으면 10001(로그인 실패) — 비밀번호 불일치(10002)와는 앱 레이어에서 구분.
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

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `login_id` = i_login_id) THEN
            SELECT 10001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            u.`user_id`, u.`company_id`, u.`requested_project_id`, u.`login_id`,
            u.`password_hash`, u.`user_name`, u.`email`, u.`phone_number`,
            u.`department`, u.`position`, u.`status`,
            COALESCE(MIN(ur.`role_code`), 40) AS role_code,
            u.`last_login_at`, u.`created_at`, u.`updated_at`
        FROM `user` u
        LEFT JOIN `user_role` ur ON u.`user_id` = ur.`user_id` AND ur.`status` = 1
        WHERE u.`login_id` = i_login_id
        GROUP BY
            u.`user_id`, u.`company_id`, u.`requested_project_id`, u.`login_id`,
            u.`password_hash`, u.`user_name`, u.`email`, u.`phone_number`,
            u.`department`, u.`position`, u.`status`,
            u.`last_login_at`, u.`created_at`, u.`updated_at`;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_LIST` (
    IN i_company_id        BIGINT UNSIGNED,  -- 회사 ID 필터 (NULL이면 전체 - SUPER_ADMIN 전용, DEVELOPER는 서비스가 항상 자기 회사로 고정)
    IN i_status            TINYINT UNSIGNED, -- 상태 필터 (NULL이면 전체)
    IN i_limit             INT,              -- 페이지당 행 수
    IN i_offset            INT,              -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '사용자 목록 조회 - status ASC 정렬, 회사 접근 재검증 (12_USER_API.md 1.1/1.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id/status 조건부 필터 + 페이지네이션. company.sql/project.sql과 동일하게
    --        별도 COUNT 서브쿼리 + LEFT JOIN ... ON TRUE로 total_count를 반환해 RESULT+data
    --        2-result-set 규약을 유지한다(COUNT(*) OVER()는 offset이 범위를 벗어나 0행이 반환되면
    --        total_count도 0으로 사라지는 버그가 있어 2026-07-19 이 패턴으로 교체).
    --        다른 테이블은 status DESC가 기본이지만 user는 "가입승인대기(0)"가 가장 먼저 보여야
    --        하는 화면 요구사항이 있어 status ASC로 정렬한다(12_USER_API.md 1.1 Sorting, 다른
    --        도메인과 다른 정렬 방향이라는 점을 주석으로 명시).
    --        password_hash는 반환 컬럼에서 제외한다 — 목록/상세 어디서도 앱으로 내보낼 이유가 없다.
    --        DEVELOPER의 회사 단위 스코핑은 앱 레이어(UserService)가 i_company_id에 항상 자기
    --        companyId를 채워 호출하는 방식으로 1차 강제하고, 이 SP도 FN_CHECK_COMPANY_ACCESS로
    --        호출자가 실제 그 회사 소속인지 2차로 재검증한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2). SUPER_ADMIN 우회는 FN_IS_SUPER_ADMIN(i_requester_user_id)로
    --        SP가 직접 DB에서 재확인한다 - 앱이 넘긴 role_code 값을 그대로 믿지 않는다.
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

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_COMPANY_ACCESS(i_requester_user_id, i_company_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`user_id`, p.`company_id`, p.`requested_project_id`, p.`login_id`, p.`user_name`, p.`email`,
            p.`phone_number`, p.`department`, p.`position`, p.`status`, p.`last_login_at`,
            p.`created_at`, p.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `user`
            WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
              AND (i_status IS NULL OR `status` = i_status)
        ) cnt
        LEFT JOIN (
            SELECT
                `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
                `phone_number`, `department`, `position`, `status`, `last_login_at`,
                `created_at`, `updated_at`
            FROM `user`
            WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
              AND (i_status IS NULL OR `status` = i_status)
            ORDER BY `status` ASC, `user_name` ASC
            LIMIT i_limit OFFSET i_offset
        ) p ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_PASSWORD_CHANGE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_PASSWORD_CHANGE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_PASSWORD_CHANGE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 대상 사용자 ID
    IN i_new_password_hash VARCHAR(255)       -- 새 비밀번호 bcrypt 해시(앱 레이어에서 해시 완료)
) COMMENT '비밀번호 변경 + 전체 활성 세션 강제 로그아웃 (09_AUTH_API.md 9장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_PASSWORD_CHANGE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 현재 비밀번호 검증(bcrypt.compare)은 앱 레이어에서 이미 끝난 상태로 호출된다.
    --        password_hash 갱신과 "모든 활성 세션 종료"(07_AUTH_SECURITY.md 1.3)를 하나의
    --        트랜잭션으로 처리해, 비밀번호는 바뀌었는데 기존 세션이 살아있는 상태가 생기지 않게 한다.
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 데이터 result set(before_json/after_json/requester_name)을 신규로 추가했다
    --        (13_LOG_AUDIT_API.md 2.4 — 본인 비밀번호 변경도 user UPDATE 감사 로그 대상). 본인
    --        조회라 requester_name도 i_user_id 자신의 user_name이다. password_hash는 '***'로
    --        마스킹한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    SELECT JSON_OBJECT(
        'user_id', `user_id`, 'company_id', `company_id`,
        'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
        'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
        'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
        'status', `status`, 'last_login_at', `last_login_at`,
        'created_at', `created_at`, 'updated_at', `updated_at`
    ) INTO v_before_json
    FROM `user` WHERE `user_id` = i_user_id;

    START TRANSACTION;

        UPDATE `user`
        SET `password_hash` = i_new_password_hash
        WHERE `user_id` = i_user_id;

        UPDATE `user_session`
        SET `status` = 0
        WHERE `user_id` = i_user_id AND `status` = 1;

    COMMIT;

    SELECT 0 AS RESULT;
    SELECT
        v_before_json AS before_json,
        JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) AS after_json,
        `user_name` AS requester_name
    FROM `user`
    WHERE `user_id` = i_user_id;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_PASSWORD_RESET
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_PASSWORD_RESET`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_PASSWORD_RESET` (
    IN i_user_id           BIGINT UNSIGNED,  -- 대상 사용자 ID
    IN i_new_password_hash VARCHAR(255),     -- 새 비밀번호 bcrypt 해시(앱 레이어에서 해시 완료)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '관리자 비밀번호 강제 초기화 - SUPER_ADMIN 재검증, 전체 활성 세션 종료 (12_USER_API.md 1.7)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_PASSWORD_RESET
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : SP_USER_PASSWORD_CHANGE(09_AUTH_API.md 9장, 본인 비밀번호 변경)와 로직은 거의
    --        동일하지만, 이쪽은 대상 user_id가 URL 파라미터로 임의 지정되므로(호출자 본인이
    --        아님) 존재 확인(31003)이 먼저 필요하다는 점이 다르다 - 그래서 SP를 공유하지 않고
    --        별도로 둔다. 현재 비밀번호 검증 없이 즉시 변경하며(12_USER_API.md 1.7 Description),
    --        password_hash 갱신과 "모든 활성 세션 종료"를 하나의 트랜잭션으로 묶는다.
    --        비밀번호 강제 초기화는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다
    --        (password_hash는 변경 전/후 모두 '***'로 마스킹 — 13_LOG_AUDIT_API.md 2.4).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user` WHERE `user_id` = i_user_id;

        START TRANSACTION;

            UPDATE `user`
            SET `password_hash` = i_new_password_hash
            WHERE `user_id` = i_user_id;

            UPDATE `user_session`
            SET `status` = 0
            WHERE `user_id` = i_user_id AND `status` = 1;

        COMMIT;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', `user_id`, 'company_id', `company_id`,
                'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
                'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
                'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
                'status', `status`, 'last_login_at', `last_login_at`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_REJECT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_REJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_REJECT` (
    IN i_user_id           BIGINT UNSIGNED,  -- 반려할 사용자 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '가입반려 - SUPER_ADMIN 재검증, status 0(대기) -> 2(반려) 조건부 UPDATE (12_USER_API.md 1.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_REJECT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : SP_USER_APPROVE와 동일한 조건부 UPDATE + 실패 사유 진단 패턴(31003 vs 30004),
    --        그리고 동일한 FN_IS_SUPER_ADMIN 재검증(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 SP_USER_APPROVE와 동일하게 UPDATE 직전
    --        v_before_json 캡처 + 결과 SELECT에 before_json/after_json/requester_name 추가
    --        (password_hash '***' 마스킹).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user` WHERE `user_id` = i_user_id;

        UPDATE `user`
        SET `status` = 2
        WHERE `user_id` = i_user_id AND `status` = 0;

        IF ROW_COUNT() = 0 THEN
            IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
                SELECT 31003 AS RESULT;
            ELSE
                SELECT 30004 AS RESULT;
            END IF;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', `user_id`, 'company_id', `company_id`,
                'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
                'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
                'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
                'status', `status`, 'last_login_at', `last_login_at`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_CREATE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 배정할 사용자 ID
    IN i_project_id        BIGINT UNSIGNED,  -- 배정할 프로젝트 ID
    IN i_role_code         TINYINT UNSIGNED, -- 권한 코드 (20/30/40 - 10은 앱 레이어 DTO 검증에서 이미 차단)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_role 배정 생성 - SUPER_ADMIN 재검증, 회사 일치 검증 + 중복 배정 차단 (12_USER_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user 존재(31003) -> project 존재(31002) -> user.company_id와 project.company_id
    --        일치 여부(다른 회사 소속 프로젝트에는 등록 불가, 12_USER_API.md 3.1 Validation) ->
    --        (user_id, project_id) 중복 배정(32001) 순으로 검증한다. 회사 불일치는 인가 실패가
    --        아니라 "이 project_id 값 자체가 이 요청에서는 허용되지 않는다"는 입력값 검증으로
    --        보아 30003(허용되지 않는 값)을 쓴다 - PERMISSION_DENIED(20001)는 호출자 본인의
    --        권한 부족에, 30003은 요청 바디 조합 자체의 유효성 문제에 쓴다는 구분을 유지한다.
    --        복합 PK(user_id, project_id) 유니크 위반(경쟁 상태 백스톱) - mysql_errno 1062.
    --        이 SP는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, FN_IS_SUPER_ADMIN으로
    --        가장 먼저 재확인한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 결과 SELECT에 after_json/requester_name과
    --        스코핑/표시명용 company_id(project 조인)/user_name/project_name을 추가했다
    --        (before_json은 CREATE라 NULL). user_role은 company_id 컬럼이 없어 project 테이블을
    --        조인해서 얻는다 - 이미 위 검증 단계에서 하던 조인 패턴 그대로다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM `user` u
            JOIN `project` p ON p.`company_id` = u.`company_id`
            WHERE u.`user_id` = i_user_id AND p.`project_id` = i_project_id
        ) THEN
            SELECT 30003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (
            SELECT 1 FROM `user_role`
            WHERE `user_id` = i_user_id AND `project_id` = i_project_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `user_role` (`user_id`, `project_id`, `role_code`)
        VALUES (i_user_id, i_project_id, i_role_code);

        SELECT 0 AS RESULT;
        SELECT
            ur.`user_id`, ur.`project_id`, ur.`role_code`, ur.`status`,
            ur.`created_at`, ur.`updated_at`,
            p.`company_id`, u.`user_name`, p.`project_name`,
            JSON_OBJECT(                    -- after_json: log_audit 스냅샷
                'user_id', ur.`user_id`, 'project_id', ur.`project_id`,
                'role_code', ur.`role_code`, 'status', ur.`status`,
                'created_at', ur.`created_at`, 'updated_at', ur.`updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user_role` ur
        JOIN `user` u ON u.`user_id` = ur.`user_id`
        JOIN `project` p ON p.`project_id` = ur.`project_id`
        WHERE ur.`user_id` = i_user_id AND ur.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_GET_BY_PROJECT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_GET_BY_PROJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_GET_BY_PROJECT` (
    IN i_user_id    BIGINT UNSIGNED,  -- 조회할 사용자 ID
    IN i_project_id BIGINT UNSIGNED   -- 조회할 프로젝트 ID
) COMMENT '특정 프로젝트에 대한 사용자의 실제 role_code 조회 (11_PROJECT_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_GET_BY_PROJECT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 헤더에서 선택된 project_id에 대한 호출자의 실제 role_code를 조회한다
    --        (11_PROJECT_API.md 3.1 — JWT의 role_code는 여러 프로젝트 중 최고 권한 하나뿐이라
    --        특정 project_id 기준 실제 권한은 이 SP로 별도 조회해야 함). 활성 배정(status=1)이
    --        없는 것은 오류가 아니라 정상적인 "미배정" 상태라 RESULT는 항상 0이고, 데이터가
    --        없으면 앱 레이어(UserRoleService)가 role_code:null로 매핑한다. SUPER_ADMIN은
    --        이 SP를 호출하지 않고 앱 레이어가 즉시 role_code:10을 반환한다(배정 여부 무관).
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
    SELECT `role_code`
    FROM `user_role`
    WHERE `user_id` = i_user_id AND `project_id` = i_project_id AND `status` = 1;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_LIST` (
    IN i_user_id           BIGINT UNSIGNED,  -- 사용자 ID 필터 (NULL이면 전체)
    IN i_project_id        BIGINT UNSIGNED,  -- 프로젝트 ID 필터 (NULL이면 전체)
    IN i_role_code         TINYINT UNSIGNED, -- 권한 코드 필터 (NULL이면 전체)
    IN i_status            TINYINT UNSIGNED, -- 상태 필터 (NULL이면 전체)
    IN i_limit             INT,              -- 페이지당 행 수
    IN i_offset            INT,              -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_role 목록 조회 - SUPER_ADMIN 재검증 (12_USER_API.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user_id/project_id/role_code/status 조건부 필터 + 페이지네이션. 다른 목록 SP와
    --        동일하게 별도 COUNT 서브쿼리 + LEFT JOIN ... ON TRUE로 total_count를 반환한다
    --        (COUNT(*) OVER()는 offset이 범위를 벗어나 0행이 반환되면 total_count도 0으로
    --        사라지는 버그가 있어 2026-07-19 이 패턴으로 교체). 정렬은
    --        12_USER_API.md 3.2 Sorting 그대로(status DESC, role_code ASC, user_id ASC).
    --        이 SP는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, FN_IS_SUPER_ADMIN으로
    --        재확인한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
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

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`user_id`, p.`project_id`, p.`role_code`, p.`status`, p.`created_at`, p.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `user_role`
            WHERE (i_user_id IS NULL OR `user_id` = i_user_id)
              AND (i_project_id IS NULL OR `project_id` = i_project_id)
              AND (i_role_code IS NULL OR `role_code` = i_role_code)
              AND (i_status IS NULL OR `status` = i_status)
        ) cnt
        LEFT JOIN (
            SELECT `user_id`, `project_id`, `role_code`, `status`, `created_at`, `updated_at`
            FROM `user_role`
            WHERE (i_user_id IS NULL OR `user_id` = i_user_id)
              AND (i_project_id IS NULL OR `project_id` = i_project_id)
              AND (i_role_code IS NULL OR `role_code` = i_role_code)
              AND (i_status IS NULL OR `status` = i_status)
            ORDER BY `status` DESC, `role_code` ASC, `user_id` ASC
            LIMIT i_limit OFFSET i_offset
        ) p ON TRUE;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_UPDATE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 복합 PK - 사용자 ID
    IN i_project_id        BIGINT UNSIGNED,  -- 복합 PK - 프로젝트 ID
    IN i_role_code         TINYINT UNSIGNED, -- 새 권한 코드 (NULL이면 미변경, 10은 불가)
    IN i_status            TINYINT UNSIGNED, -- 새 상태 (NULL이면 미변경)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_role 수정 - SUPER_ADMIN 재검증, 조건부 UPDATE, role_code=10 전환 차단 (12_USER_API.md 3.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user_id/project_id는 복합 PK라 이 SP에서 변경 대상이 아니다(Non-Updatable Fields,
    --        12_USER_API.md 3.3). role_code=10(SUPER_ADMIN)으로의 변경은 명시적으로 30003을
    --        반환한다(3.3 Business Rules) - DTO 레이어에서 20/30/40으로 막지 않고 여기서 막는
    --        이유는 문서가 이 케이스를 SP/서비스 레벨의 명시적 오류 코드로 지정했기 때문이다.
    --        물리 삭제 없음 원칙에 따라 권한 중지는 status=0 조건부 UPDATE로만 처리한다.
    --        이 SP는 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, FN_IS_SUPER_ADMIN으로
    --        가장 먼저 재확인한다(방어적 이중 체크, 02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name과 스코핑/표시명용
    --        company_id(project 조인)/user_name/project_name을 추가했다(SP_USER_ROLE_CREATE와
    --        동일한 조인 패턴).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF i_role_code = 10 THEN
            SELECT 30003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM `user_role` WHERE `user_id` = i_user_id AND `project_id` = i_project_id
        ) THEN
            SELECT 31007 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷
            'user_id', `user_id`, 'project_id', `project_id`, 'role_code', `role_code`,
            'status', `status`, 'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user_role` WHERE `user_id` = i_user_id AND `project_id` = i_project_id;

        UPDATE `user_role`
        SET
            `role_code` = COALESCE(i_role_code, `role_code`),
            `status`    = COALESCE(i_status, `status`)
        WHERE `user_id` = i_user_id AND `project_id` = i_project_id;

        SELECT 0 AS RESULT;
        SELECT
            ur.`user_id`, ur.`project_id`, ur.`role_code`, ur.`status`,
            ur.`created_at`, ur.`updated_at`,
            p.`company_id`, u.`user_name`, p.`project_name`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', ur.`user_id`, 'project_id', ur.`project_id`,
                'role_code', ur.`role_code`, 'status', ur.`status`,
                'created_at', ur.`created_at`, 'updated_at', ur.`updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user_role` ur
        JOIN `user` u ON u.`user_id` = ur.`user_id`
        JOIN `project` p ON p.`project_id` = ur.`project_id`
        WHERE ur.`user_id` = i_user_id AND ur.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_CREATE` (
    IN i_user_id             BIGINT UNSIGNED,  -- 로그인한 사용자 ID
    IN i_access_token_jti    VARCHAR(100),      -- 발급한 Access Token의 JTI
    IN i_refresh_token_hash  VARCHAR(255),      -- Refresh Token(UUID v4) SHA-256 해시값
    IN i_expired_at          DATETIME          -- 세션 만료일시(JWT_REFRESH_EXPIRES_IN만큼 더한 절대시각)
) COMMENT '로그인 세션 생성 - last_login_at 갱신 + user_session INSERT (09_AUTH_API.md 5장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인 성공 시 user.last_login_at 갱신과 user_session INSERT를 하나의 트랜잭션으로 처리해
    --        원자성을 보장한다. role_code는 이미 SP_USER_GET_BY_LOGIN_ID에서 계산했으므로 여기서
    --        다시 계산하지 않는다(순수 세션 기록 전용).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_now         DATETIME     DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    SET v_now = NOW();

    START TRANSACTION;

        UPDATE `user`
        SET `last_login_at` = v_now
        WHERE `user_id` = i_user_id;

        INSERT INTO `user_session` (
            `user_id`, `access_token_jti`, `refresh_token_hash`, `expired_at`, `last_access_at`, `status`
        ) VALUES (
            i_user_id, i_access_token_jti, i_refresh_token_hash, i_expired_at, v_now, 1
        );

    COMMIT;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_GET_BY_REFRESH_HASH
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_GET_BY_REFRESH_HASH`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_GET_BY_REFRESH_HASH` (
    IN i_refresh_token_hash VARCHAR(255)  -- Refresh Token SHA-256 해시값
) COMMENT 'Refresh Token 해시로 활성 세션 조회, role_code 재계산 (09_AUTH_API.md 7장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_GET_BY_REFRESH_HASH
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : POST /auth/refresh 처리용 세션 조회. status=1이고 만료되지 않은 세션만 대상으로 하며,
    --        세션이 없거나 만료된 경우를 구분하지 않고 10008(Refresh Token 만료)로 통일한다.
    --        role_code는 SP_USER_GET_BY_LOGIN_ID와 동일하게 이 시점에 다시 계산한다(저장값을
    --        그대로 반환하지 않음 — 09_AUTH_API.md 7장 참고).
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

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `user_session`
            WHERE `refresh_token_hash` = i_refresh_token_hash AND `status` = 1 AND `expired_at` > NOW()
        ) THEN
            SELECT 10008 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            s.`session_id`, s.`user_id`, u.`status` AS user_status, u.`company_id`,
            COALESCE(MIN(ur.`role_code`), 40) AS role_code
        FROM `user_session` s
        JOIN `user` u ON s.`user_id` = u.`user_id`
        LEFT JOIN `user_role` ur ON u.`user_id` = ur.`user_id` AND ur.`status` = 1
        WHERE s.`refresh_token_hash` = i_refresh_token_hash AND s.`status` = 1 AND s.`expired_at` > NOW()
        GROUP BY s.`session_id`, s.`user_id`, u.`status`, u.`company_id`;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_LOGOUT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_LOGOUT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_LOGOUT` (
    IN i_access_token_jti VARCHAR(100)  -- 로그아웃할 현재 Access Token의 JTI
) COMMENT '현재 세션 로그아웃 - status=0 (09_AUTH_API.md 6장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_LOGOUT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : JwtAuthGuard가 이미 유효성을 확인한 access_token_jti 기준으로 현재 세션만 종료한다.
    --        조건부 UPDATE(status=1인 행만 대상)라 이미 로그아웃된 세션에 다시 호출해도 안전하다
    --        (영향받은 행이 0건이어도 에러가 아니라 정상 종료 취급 — 멱등하게 동작).
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

    UPDATE `user_session`
    SET `status` = 0
    WHERE `access_token_jti` = i_access_token_jti AND `status` = 1;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_UPDATE_JTI
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_UPDATE_JTI`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_UPDATE_JTI` (
    IN i_session_id       BIGINT UNSIGNED,  -- 세션 ID
    IN i_access_token_jti VARCHAR(100)       -- 새로 발급한 Access Token JTI
) COMMENT 'Access Token 재발급 시 세션의 JTI/last_access_at 갱신 (09_AUTH_API.md 7장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_UPDATE_JTI
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : POST /auth/refresh 처리 후 세션의 access_token_jti를 새 값으로 갱신한다.
    --        refresh_token은 재발급하지 않으므로(최초 로그인 시 1회만 저장) 여기서 건드리지 않는다.
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

    UPDATE `user_session`
    SET `access_token_jti` = i_access_token_jti,
        `last_access_at` = NOW()
    WHERE `session_id` = i_session_id;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_VALIDATE_BY_JTI
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_VALIDATE_BY_JTI`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_VALIDATE_BY_JTI` (
    IN i_access_token_jti VARCHAR(100)  -- 검증할 Access Token의 JTI
) COMMENT 'JwtAuthGuard 전용 - 세션/사용자 상태 검증 (07_AUTH_SECURITY.md 1.5 3~4번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_VALIDATE_BY_JTI
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 보호된 API 요청마다 JwtAuthGuard가 호출하는 세션/사용자 상태 검증
    --        (07_AUTH_SECURITY.md 1.5 "3. Session 확인 / 4. User 상태 확인").
    --        role_code는 여기서 다시 조회하지 않는다 — Access Token(JWT) 자체가 이미 서명으로
    --        보증된 role_code를 담고 있어, 매 요청마다 user_role을 다시 조인하는 건 불필요한 비용이다
    --        (role_code는 로그인/재발급 시점에만 재계산, 09_AUTH_API.md 7장 참고).
    --        세션이 없거나 로그아웃(status!=1)되었거나 만료(expired_at<=NOW())된 경우
    --        10009(유효하지 않은 Session)를 반환한다 — expired_at 체크가 없으면 세션 만료 이후에도
    --        그 직전에 발급된 Access Token이 자기 수명(15분)이 남아있는 동안 계속 통과해버리는
    --        구멍이 생긴다(2026-07-19 리뷰에서 발견, SP_USER_SESSION_GET_BY_REFRESH_HASH와
    --        동일하게 맞춤).
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

    proc_block: BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM `user_session`
            WHERE `access_token_jti` = i_access_token_jti AND `status` = 1 AND `expired_at` > NOW()
        ) THEN
            SELECT 10009 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT u.`user_id`, u.`company_id`, u.`status` AS user_status
        FROM `user_session` s
        JOIN `user` u ON s.`user_id` = u.`user_id`
        WHERE s.`access_token_jti` = i_access_token_jti AND s.`status` = 1 AND s.`expired_at` > NOW();
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SIGNUP
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SIGNUP`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SIGNUP` (
    IN i_company_id            BIGINT UNSIGNED,  -- 가입 신청 회사 ID
    IN i_requested_project_id  BIGINT UNSIGNED,  -- 가입 신청 프로젝트 ID (영구 보관, 이후 변경 불가)
    IN i_login_id              VARCHAR(100),      -- 로그인 ID
    IN i_password_hash         VARCHAR(255),      -- bcrypt 해시(앱 레이어에서 해시 완료 후 전달)
    IN i_user_name             VARCHAR(100),      -- 사용자명
    IN i_email                 VARCHAR(200),      -- 이메일
    IN i_phone_number_enc      VARCHAR(255),      -- 휴대폰번호 AES-256-CBC 암호화값(앱 레이어에서 암호화 완료 후 전달)
    IN i_department            VARCHAR(100),      -- 부서 (선택)
    IN i_position              VARCHAR(100)       -- 직급 (선택)
) COMMENT '회원가입 - status=0(가입승인대기)으로 user INSERT (09_AUTH_API.md 4장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SIGNUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회원가입 처리. company_id/requested_project_id 존재 및 소속 관계를 검증하고,
    --        login_id/email 중복을 확인한 뒤 status=0(가입승인대기)으로 user를 생성한다.
    --        password_hash/phone_number 암호화는 이미 앱 레이어(bcrypt/CryptoService)에서 끝난 값을
    --        그대로 저장한다 — SP는 암호화 로직을 모른다.
    --        아래 IF EXISTS 사전 체크는 일반적인 경우엔 빠르고 명확하지만 원자적이지 않다 — 동시에
    --        같은 login_id/email로 두 요청이 들어오면 둘 다 통과해버릴 수 있다. 그 드문 경쟁 상황을
    --        대비해 INSERT의 UNIQUE 제약 위반(1062) 전용 핸들러를 추가로 둬서, 사전 체크를 통과한
    --        뒤에도 실제 INSERT에서 걸리면 50001이 아니라 32001로 정확히 응답되게 한다
    --        (2026-07-19 리뷰에서 발견 — SP_NONCE_INSERT와 같은 원리).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_user_id     BIGINT       DEFAULT NULL;

    -- login_id/email 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM `project`
            WHERE `project_id` = i_requested_project_id AND `company_id` = i_company_id
        ) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (SELECT 1 FROM `user` WHERE `login_id` = i_login_id OR `email` = i_email) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `user` (
            `company_id`, `requested_project_id`, `login_id`, `password_hash`,
            `user_name`, `email`, `phone_number`, `department`, `position`, `status`
        ) VALUES (
            i_company_id, i_requested_project_id, i_login_id, i_password_hash,
            i_user_name, i_email, i_phone_number_enc, i_department, i_position, 0
        );

        SET v_user_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`,
            `email`, `phone_number`, `department`, `position`, `status`,
            `last_login_at`, `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = v_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_UPDATE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 수정할 사용자 ID
    IN i_user_name         VARCHAR(100),     -- 새 사용자명 (NULL이면 미변경)
    IN i_email             VARCHAR(200),     -- 새 이메일 (NULL이면 미변경)
    IN i_phone_number_enc  VARCHAR(255),     -- 새 휴대폰번호 AES-256-CBC 암호화값 (NULL이면 미변경)
    IN i_department        VARCHAR(100),     -- 새 부서 (NULL이면 미변경)
    IN i_position          VARCHAR(100),     -- 새 직급 (NULL이면 미변경)
    IN i_status            TINYINT UNSIGNED, -- 새 상태 (NULL이면 미변경)
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '사용자 정보 수정 - SUPER_ADMIN 재검증, 조건부 UPDATE + status=3 전환 시 전체 세션 종료 (12_USER_API.md 1.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id/requested_project_id/login_id는 이 SP의 파라미터에 아예 없다 - 수정 불가
    --        필드라 애초에 받지 않는다(12_USER_API.md 1.6 Non-Updatable Fields). 존재 확인(31003)
    --        -> email 변경 시 중복 확인(자기 자신 제외, 32001) -> COALESCE 기반 조건부 UPDATE
    --        (02_DEV_CONVENTIONS.md 4장). email 유니크 제약 위반(1062) 백스톱도 CREATE/UPDATE류
    --        SP와 동일한 이유로 둔다.
    --        i_status=3(사용중지)으로 전환하는 경우에만 해당 사용자의 활성 세션을 전부 종료한다
    --        (12_USER_API.md 1.6 Business Rules, 07_AUTH_SECURITY.md 1.3) - 이미 3이었거나 다른
    --        값으로 바뀌는 경우는 세션에 영향을 주지 않는다. UPDATE 규약(3.4)은 status 값 전이
    --        자체를 검증하지 않는다고 명시하므로(화면 버튼 기준일 뿐) 여기서도 임의의 status 값
    --        전달을 그대로 허용한다.
    --        사용자 수정은 SUPER_ADMIN 전용이라 RolesGuard가 이미 막고 있지만, 이 SP도
    --        FN_IS_SUPER_ADMIN으로 가장 먼저 재확인한다(방어적 이중 체크,
    --        02_DEV_CONVENTIONS.md 3.2).
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 before_json/after_json/requester_name을 추가했다
    --        (password_hash '***' 마스킹).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;

    -- email 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF i_email IS NOT NULL AND EXISTS (
            SELECT 1 FROM `user` WHERE `email` = i_email AND `user_id` <> i_user_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(
            'user_id', `user_id`, 'company_id', `company_id`,
            'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
            'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
            'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
            'status', `status`, 'last_login_at', `last_login_at`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `user` WHERE `user_id` = i_user_id;

        START TRANSACTION;

            UPDATE `user`
            SET
                `user_name`    = COALESCE(i_user_name, `user_name`),
                `email`        = COALESCE(i_email, `email`),
                `phone_number` = COALESCE(i_phone_number_enc, `phone_number`),
                `department`   = COALESCE(i_department, `department`),
                `position`     = COALESCE(i_position, `position`),
                `status`       = COALESCE(i_status, `status`)
            WHERE `user_id` = i_user_id;

            IF i_status = 3 THEN
                UPDATE `user_session`
                SET `status` = 0
                WHERE `user_id` = i_user_id AND `status` = 1;
            END IF;

        COMMIT;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'user_id', `user_id`, 'company_id', `company_id`,
                'requested_project_id', `requested_project_id`, 'login_id', `login_id`,
                'password_hash', '***', 'user_name', `user_name`, 'email', `email`,
                'phone_number', `phone_number`, 'department', `department`, 'position', `position`,
                'status', `status`, 'last_login_at', `last_login_at`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_requester_user_id) AS requester_name
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;
