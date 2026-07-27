DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_ISSUE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_ISSUE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_code_value         VARCHAR(50),      -- FIXED 전용 코드값(RANDOM이면 NULL)
    IN i_requester_user_id  BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '코드 발급 요청 - RANDOM은 진행중 전환만(202), FIXED는 코드 1건 동기 등록(200) (19_CAMPAIGN_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_CAMPAIGN_CODE_ISSUE
    -- 작성 : 2026.07.21 trisakion
    -- 수정2: 2026.07.22 trisakion — FIXED 완료 UPDATE의 `generated_qty=1` 하드코딩을
    --        `generated_qty=requested_qty`로 교체(SP_CAMPAIGN_CREATE 수정1과 짝). FIXED는
    --        여전히 coupon_code 물리 행 1건만 만들지만, 캠페인 레벨의 requested_qty/
    --        generated_qty는 이제 "코드 개수"가 아니라 "그 1건이 지원할 총 사용가능 횟수"를
    --        의미한다 - 이전엔 강제로 1이라 usable_qty<=generated_qty 제약(19_CAMPAIGN_API.md
    --        2.4) 때문에 FIXED 캠페인이 사실상 전체 통틀어 딱 1번만 소모 가능했다(S2S reserve
    --        스모크 테스트에서 발견, 08_COUPON_USAGE_SCENARIO.md 4.2가 명시한 "서로 다른 유저가
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
    --        선점 당시 값(2)에 그대로 남지만, 07_COUPON_ISSUANCE_SCENARIO.md 2.5가 이미 정한
    --        원칙(종료된 캠페인의 generation_status는 억지로 전이시키지 않는다 — 1.3이 모든 쓰기를
    --        차단하므로 무해함)과 동일하게 취급해 별도로 되돌리지 않는다.
    -- 내용 : 존재 확인(31004) -> 프로젝트 스코핑 재검증(FN_CHECK_PROJECT_ACCESS, 20001 — 이 SP는
    --        role_code 값 자체가 필요 없어 FN_GET_PROJECT_ROLE_CODE 대신 boolean 버전을 쓴다.
    --        07_COUPON_ISSUANCE_SCENARIO.md 1장: 코드 발급은 approval_status와 무관하게 호출
    --        가능하므로 승인상태는 아예 확인하지 않는다) -> FIXED인데 code_value가 없으면
    --        30001(필수값 누락, DTO가 code_type을 몰라 걸러줄 수 없어 여기서 재검증) 순으로 처리한다.
    --        그 다음 "generation_status 1(대기)->2(진행중)" 조건부 UPDATE로 이 job을 원자적으로
    --        선점한다(status<>4도 같은 WHERE절에 포함 — 1.3 종료 캠페인 잠금). 캠페인당 코드 발급
    --        job은 1회뿐이라(07_COUPON_ISSUANCE_SCENARIO.md 1장) 이 조건부 UPDATE 자체가 동시에
    --        들어온 두 번째 발급 요청을 막는 락 역할을 겸한다 - ROW_COUNT()=0이면 이미 발급
    --        요청됐거나(생성/진행중/완료/실패 중 대기가 아님) 캠페인이 종료됐다는 뜻이라 둘 다
    --        30004로 답한다(19_CAMPAIGN_API.md 3.1 Precondition, 상세 사유 구분은 API 스펙에도
    --        없어 필요 없음).
    --        선점 이후 code_type으로 분기한다:
    --        - RANDOM(1): 여기서 할 일이 끝난다 - 실제 대량생성은 TS 서비스가 이 SP가 반환하는
    --          project_id/use_hyphen/requested_qty를 가지고 백그라운드로 수행한다(SP는 생성 루프를
    --          모른다 - nanoid는 앱 레이어 라이브러리라 SQL에서 호출할 수 없다,
    --          06_DATABASE_SCHEMA.md 6장 코드 생성 규칙 참고).
    --        - FIXED(2): 코드 1건을 즉시 INSERT한다. UNIQUE(project_id, code_value) 충돌은 이
    --          INSERT 문 범위로 좁힌 CONTINUE HANDLER FOR 1062로만 잡는다(더 일반적인 바깥
    --          EXIT HANDLER FOR SQLEXCEPTION보다 특정 조건 핸들러가 우선한다는 MySQL 규칙을
    --          이용) - 충돌 시 방금 선점한 generation_status를 1로 되돌려(재요청 가능하게) 32001을
    --          반환한다. 성공하면 generated_qty=requested_qty=1, generation_status=3(완료)까지
    --          이 SP 안에서 동기로 확정한다 - 단 이 완료 UPDATE도 `status<>4`를 조건으로 걸어,
    --          INSERT 이후 COMMIT 전 그 사이 캠페인이 종료됐으면 INSERT까지 함께 되돌리고
    --          30004를 반환한다(수정1 참고).
    --        edit_count는 건드리지 않는다 - 19_CAMPAIGN_API.md 2.4가 edit_count 대상 SP로 나열한
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
                -- (07_COUPON_ISSUANCE_SCENARIO.md 2.2 - FIXED는 실패해도 generation_status=1 유지).
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
                -- (07_COUPON_ISSUANCE_SCENARIO.md 2.5와 동일한 원칙 - 억지로 되돌리지 않는다).
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
