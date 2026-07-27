DROP PROCEDURE IF EXISTS `SP_COUPON_RESERVE`;
DELIMITER $$
CREATE PROCEDURE `SP_COUPON_RESERVE` (
    IN i_project_id  BIGINT UNSIGNED,  -- S2S 인증으로 스코핑된 project_id
    IN i_code_value  VARCHAR(50),      -- coupon_code.code_value
    IN i_game_user_id VARCHAR(100)     -- 게임서버 유저 식별자
) COMMENT '쿠폰 코드 예약(=즉시 소모 확정) - reserve (20_COUPON_USAGE_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COUPON_RESERVE
    -- 작성 : 2026.07.22 trisakion
    -- 내용 : 08_COUPON_USAGE_SCENARIO.md 2.1/2.2/2.3을 그대로 구현한다.
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
    --        5) coupon_code_usage 먼저 INSERT(confirmed_at=NULL)
    --        6) 사용자당 한도 재확인(`SELECT COUNT(*) ... FOR UPDATE`, 방금 넣은 5번 행 포함해서
    --           카운트) - 한도 초과 시 33003(ROLLBACK, 5번 INSERT도 함께 취소) 아니면 COMMIT
    --        5/6 순서를 "한도확인 -> INSERT"가 아니라 "INSERT -> 한도확인"으로 둔 이유(2026-07-22
    --        감사 후 수정): 원래 순서(한도확인 SELECT...FOR UPDATE를 먼저 실행)는 완전히 동일한
    --        요청(같은 코드+같은 유저)이 진짜 동시에 들어오면 두 트랜잭션이 아직 아무 행도 없는
    --        같은 갭에 서로 호환되는 갭락을 동시에 얻은 뒤 둘 다 INSERT를 시도하면서 서로의
    --        insert-intention lock과 충돌해 데드락(1213 -> 50001)이 나는 경로가 있었다(RANDOM은
    --        3번의 코드 행 락이 먼저 걸려 이 경로를 안 타므로 FIXED 관련 경로에서만 발생, use_limit
    --        값과 무관하게 발생 가능). INSERT를 먼저 하면 두 INSERT는 서로 락 경합 없이 독립적으로
    --        들어가고 그 다음 FOR UPDATE 재확인이 상대방의 미커밋 행과 마주쳤을 때만 대기하므로
    --        데드락 가능성이 크게 줄어들고, 설령 그 좁은 타이밍에 데드락이 나더라도 진 쪽이
    --        재시도하면 이번엔 2번 멱등 체크가 이긴 쪽의 커밋된 행을 찾아 동일한 성공 응답을
    --        재현하므로 데이터 정합성(한도 초과 없음)과 최종 재시도 수렴 모두 보장된다.
    --        RANDOM 코드 잠금(3)과 이후 단계(4/5/6)를 하나의 트랜잭션으로 묶기 위해 START
    --        TRANSACTION을 코드 조회 직후(멱등 체크 이후)에 연다 - FIXED는 3단계에 UPDATE가
    --        없지만 같은 트랜잭션 안에서 4/5/6이 처리되어도 무해하다(단순 SELECT 체크 후 그대로
    --        진행).
    --        반환 컬럼(coupon_code_usage_id/coupon_campaign_id/code_value/game_user_id/
    --        reward_data/created_at)은 20_COUPON_USAGE_API.md 2.1 Response를 그대로 따른다 -
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

        -- 멱등 체크(use_limit_per_user=1일 때만, 08_COUPON_USAGE_SCENARIO.md 1.2)
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

        INSERT INTO `coupon_code_usage`
            (`coupon_code_id`, `coupon_campaign_id`, `project_id`, `game_user_id`, `confirmed_at`)
        VALUES
            (v_coupon_code_id, v_coupon_campaign_id, i_project_id, i_game_user_id, NULL);

        SET v_new_usage_id = LAST_INSERT_ID();

        SELECT COUNT(*) INTO v_usage_count
        FROM `coupon_code_usage`
        WHERE `coupon_campaign_id` = v_coupon_campaign_id AND `game_user_id` = i_game_user_id
        FOR UPDATE;

        IF v_usage_count > v_use_limit THEN
            ROLLBACK;
            SELECT 33003 AS RESULT;
            LEAVE proc_block;
        END IF;

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
