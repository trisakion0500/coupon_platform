DROP PROCEDURE IF EXISTS `SP_USER_ROLE_GET_BY_PROJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_GET_BY_PROJECT` (
    IN i_user_id    BIGINT UNSIGNED,  -- 조회할 사용자 ID
    IN i_project_id BIGINT UNSIGNED   -- 조회할 프로젝트 ID
) COMMENT '특정 프로젝트에 대한 사용자의 실제 role_code 조회 (13_PROJECT_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_GET_BY_PROJECT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 헤더에서 선택된 project_id에 대한 호출자의 실제 role_code를 조회한다
    --        (13_PROJECT_API.md 3.1 — JWT의 role_code는 여러 프로젝트 중 최고 권한 하나뿐이라
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
