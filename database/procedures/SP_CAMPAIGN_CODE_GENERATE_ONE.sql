DROP PROCEDURE IF EXISTS `SP_CAMPAIGN_CODE_GENERATE_ONE`;
DELIMITER $$
CREATE PROCEDURE `SP_CAMPAIGN_CODE_GENERATE_ONE` (
    IN i_coupon_campaign_id BIGINT UNSIGNED,  -- 대상 캠페인 ID
    IN i_project_id         BIGINT UNSIGNED,  -- 비정규화 project_id(coupon_code.project_id)
    IN i_code_value         VARCHAR(50)       -- 앱 레이어(nanoid)가 생성한 코드값 1건
) COMMENT 'RANDOM 코드 1건 생성(내부용) - requested_qty 상한 + generation_status=2/status<>4 가드, INSERT/generated_qty 증가를 트랜잭션으로 원자 처리 (07_COUPON_ISSUANCE_SCENARIO.md 2.2)'
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
    --        캠페인의 generation_status는 억지로 전이시키지 않는다 - 19_CAMPAIGN_API.md 1.3이
    --        종료된 캠페인의 모든 쓰기 API를 이미 차단하므로 더 손댈 필요가 없는 무해한 상태다.
    -- 내용 : SP_CAMPAIGN_CODE_ISSUE/RETRY로 이미 권한 검증 + generation_status=2(진행중) 선점을
    --        마친 뒤, TS 서비스의 백그라운드 루프가 requested_qty만큼 이 SP를 반복 호출한다
    --        (07_COUPON_ISSUANCE_SCENARIO.md 2.1 R2~R7 루프). 그래서 이 SP 자체는 요청자
    --        재검증을 하지 않는다 - 공개 API에서 직접 호출되는 대상이 아니라 이미 검증된
    --        백그라운드 작업 내부에서만 쓰인다(SP_SESSION_CLEANUP 등 기존 내부 배치 SP와 동일한
    --        원칙). nanoid로 코드값을 만드는 것은 앱 레이어 책임이다 - SQL에는 nanoid가 없고,
    --        코드값 자체를 SP가 생성하면 충돌 시 "새 값으로 재시도"를 SP 안에서 루프 돌려야 해서
    --        오히려 복잡해진다.
    --        처리 순서: (1) "generated_qty+1, WHERE generated_qty<requested_qty AND
    --        generation_status=2 AND status<>4" 조건부 UPDATE로 슬롯을 먼저 예약한다
    --        (04_DEV_CONVENTIONS.md 4장 "조건부 갱신 우선"). ROW_COUNT()=0이면 이미 목표
    --        수량에 도달했거나(정상 종료 경로), 누군가 이 job을 이미 종료시켰거나(abort),
    --        캠페인 자체가 종료됐다는 뜻이므로 코드를 만들지 않고 현재 generated_qty/
    --        generation_status/status를 그대로 반환한다(RESULT=0, no-op 성공). (2) 슬롯 예약에
    --        성공했을 때만 실제 coupon_code INSERT를 시도한다. 코드값 충돌(UNIQUE(project_id,
    --        code_value))은 이 INSERT 문 범위로 좁힌 CONTINUE HANDLER FOR 1062로만 흡수한다
    --        (바깥 EXIT HANDLER FOR SQLEXCEPTION보다 특정 조건 핸들러가 우선) - 충돌이면
    --        ROLLBACK으로 방금 예약한 슬롯(generated_qty 증가분)까지 함께 되돌리고(같은
    --        트랜잭션이라 한 번의 ROLLBACK으로 둘 다 취소됨) 32001을 반환해 앱이 지연 없이 새
    --        랜덤값으로 재시도하게 한다(코드값 재추첨은 backoff 대상이 아님,
    --        07_COUPON_ISSUANCE_SCENARIO.md 2.2 표 참고). 그 외 SQLEXCEPTION(예: DB 커넥션
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
