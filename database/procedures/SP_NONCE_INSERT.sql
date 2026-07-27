DROP PROCEDURE IF EXISTS `SP_NONCE_INSERT`;
DELIMITER $$
CREATE PROCEDURE `SP_NONCE_INSERT` (
    IN i_project_id BIGINT UNSIGNED,  -- 인증된 project_id (project.project_id)
    IN i_nonce      VARCHAR(64)       -- X-API-Nonce 헤더 원문
) COMMENT 'S2S nonce 원자적 등록 — UNIQUE 위반이면 재전송으로 판단해 10015 반환(docs/09_AUTH_SECURITY.md 2.4 6번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_NONCE_INSERT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : S2S 인증 가드(docs/09_AUTH_SECURITY.md 2.4 6번)의 재전송 방지 nonce 등록.
    --        (project_id, nonce) UNIQUE 제약 위반을 "이미 사용된 nonce(재전송 의심)"으로 판단해 10015를
    --        반환한다. 04_DEV_CONVENTIONS.md 3.4는 "예측 가능한 실패는 예외로 던지지 않는다"는 원칙이지만
    --        이 SP는 의도적 예외다 — INSERT 자체의 원자적 유니크 제약 위반을 이용해야만 동시에 같은 nonce가
    --        들어와도 정확히 하나만 성공시킬 수 있다(체크 후 INSERT는 두 요청이 동시에 통과하는 경쟁 상태를
    --        막지 못함, docs/09_AUTH_SECURITY.md 2.5 참고).
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
