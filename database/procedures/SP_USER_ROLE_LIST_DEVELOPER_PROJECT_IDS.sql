DROP PROCEDURE IF EXISTS `SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS` (
    IN i_user_id BIGINT UNSIGNED  -- 조회할 사용자 ID(호출측이 항상 자기 자신의 ID만 넘김)
) COMMENT '호출자가 DEVELOPER 이상으로 배정된 프로젝트 ID 목록(콤마 구분) 조회 (13_LOG_AUDIT_API.md 3장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_LIST_DEVELOPER_PROJECT_IDS
    -- 작성 : 2026.07.24 trisakion
    -- 내용 : 감사 로그(log_audit) 조회 API가 DEVELOPER의 project/user_role 테이블 로그 조회
    --        범위를 "본인 소속 회사 전체"에서 "실제 role_code<=20(DEVELOPER 이상)으로 배정된
    --        프로젝트"로 좁히기 위해 만들었다(13_LOG_AUDIT_API.md 3장, 2026-07-24 — 프로젝트
    --        관리메뉴 스코핑을 회사 단위에서 배정 프로젝트 단위로 좁힌 것과 동일한 방향).
    --        log_audit는 로그 DB(coupon_platform_log)에 있어 메인 DB의 user_role을 직접 조인할
    --        수 없으므로(02_DEV_CONVENTIONS.md 1장/3.2 물리분리 예외), 앱 레이어(LogAuditService)가
    --        이 SP로 먼저 허용 project_id 목록을 콤마 문자열로 받아, 로그 DB SP(SP_LOG_AUDIT_LIST)
    --        호출 시 필터 파라미터로 그대로 전달하는 2단계 패턴을 쓴다(02_DEV_CONVENTIONS.md 3.2
    --        "메인 DB 접근권한 확인 → 로그 DB 조회" 패턴의 변형 — boolean 결과 대신 목록 자체를
    --        넘긴다는 점만 다르다).
    --        FN_GET_PROJECT_ROLE_CODE(단건 조회 전용)와 달리 이건 목록이 필요해 별도 SP로 뺐다.
    --        배정이 하나도 없으면 GROUP_CONCAT이 NULL을 반환하므로(빈 목록), 앱 레이어가 이를
    --        빈 문자열로 취급해 project/user_role 로그를 전부 걸러내도록 한다(전체 허용으로
    --        오인되지 않도록 - SUPER_ADMIN의 "제한 없음"과 명확히 구분).
    --        호출자가 자기 자신의 user_id만 조회하는 용도라 SP_USER_ROLE_GET_BY_PROJECT와
    --        동일하게 별도 권한 재검증(FN_IS_SUPER_ADMIN 등)이 필요 없다 - 앱 레이어가 항상
    --        JWT의 본인 user_id만 넘긴다.
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
    SELECT GROUP_CONCAT(`project_id`) AS project_ids
    FROM `user_role`
    WHERE `user_id` = i_user_id AND `role_code` <= 20 AND `status` = 1;
END$$

DELIMITER ;
