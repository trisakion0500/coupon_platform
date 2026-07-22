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
