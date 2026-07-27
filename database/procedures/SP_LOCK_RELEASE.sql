DROP PROCEDURE IF EXISTS `SP_LOCK_RELEASE`;
DELIMITER $$
CREATE PROCEDURE `SP_LOCK_RELEASE` (
    IN i_lock_name VARCHAR(64)  -- 해제할 advisory lock 이름(SP_LOCK_ACQUIRE와 동일 값)
) COMMENT '레플리카 간 배치 중복실행 방지용 MySQL advisory lock 해제 (RELEASE_LOCK) - 04_DEV_CONVENTIONS.md 4.1'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_LOCK_RELEASE
    -- 작성 : 2026.07.26 trisakion
    -- 내용 : SP_LOCK_ACQUIRE로 획득한 advisory lock을 해제한다. 반드시 획득할 때와 동일한
    --        커넥션(세션)에서 호출해야 한다 — advisory lock은 세션에 종속되므로 다른 세션에서
    --        호출하면 아무 효과가 없다(RELEASE_LOCK이 0을 반환할 뿐, 에러는 아니다). 반환값
    --        (해제 성공 여부)은 호출부(SpExecutorService.runExclusive의 finally 블록)가 실제로
    --        읽어 판단하지 않지만(락 해제는 실패해도 커넥션이 pool로 반환되며 세션이 끝나는
    --        시점에 MySQL이 결국 정리한다), RESULT SELECT 규약(04_DEV_CONVENTIONS.md 3.4)을
    --        일관되게 지키기 위해 반환한다.
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
    SELECT COALESCE(RELEASE_LOCK(i_lock_name), 0) AS released;
END$$

DELIMITER ;
