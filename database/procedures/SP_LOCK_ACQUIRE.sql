DROP PROCEDURE IF EXISTS `SP_LOCK_ACQUIRE`;
DELIMITER $$
CREATE PROCEDURE `SP_LOCK_ACQUIRE` (
    IN i_lock_name VARCHAR(64)  -- 획득할 advisory lock 이름(레플리카 간 공유되는 배치 식별 키)
) COMMENT '레플리카 간 배치 중복실행 방지용 MySQL advisory lock 획득 (GET_LOCK, non-blocking) - 04_DEV_CONVENTIONS.md 4.1'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOCK_ACQUIRE
    -- 작성 : 2026.07.26 trisakion
    -- 내용 : SpExecutorService.runExclusive가 쓰는 세션 수준 advisory lock 획득 전용 SP. GET_LOCK을
    --        raw SQL(SELECT GET_LOCK(...))로 직접 호출하던 걸 SP로 감쌌다 — 이 프로젝트의
    --        "ORM/Native SQL 직접 작성 금지, SP 전용" 정책(02_TECH_STACK.md)의 유일한 예외였고,
    --        운영 DB 계정을 SP 실행(EXECUTE) 권한만 허용하는 모델로 굳힐 계획이라 SP로 감싸지
    --        않은 순수 SELECT 문은 그 계정으로 아예 실행이 안 될 수 있다.
    --        timeout=0(non-blocking)으로 시도해 이미 다른 레플리카가 점유 중이면 즉시 포기한다 —
    --        크론은 다음 스케줄에 또 돌아오므로 여기서 기다릴 이유가 없다. GET_LOCK이 드물게
    --        NULL(내부 오류, 예: 메모리 부족)을 반환해도 COALESCE로 0(미획득)과 동일하게 처리해
    --        앱이 항상 안전한 쪽(락을 못 잡은 것으로 간주)으로 fail하게 한다.
    --        주의: 이 SP는 반드시 호출부가 pool에서 직접 뽑아 유지하는 단일 커넥션 위에서
    --        호출해야 한다(SpExecutorService.callProcedure처럼 매번 pool이 임의로 골라주는
    --        커넥션을 쓰면 락을 건 세션과 다른 세션이 되어버려 advisory lock의 세션 종속 특성이
    --        깨진다). SP_LOCK_RELEASE도 반드시 같은 커넥션에서 호출해야 한다.
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
    SELECT COALESCE(GET_LOCK(i_lock_name, 0), 0) AS acquired;
END$$

DELIMITER ;
