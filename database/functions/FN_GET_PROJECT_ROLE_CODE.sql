DROP FUNCTION IF EXISTS `FN_GET_PROJECT_ROLE_CODE`;
DELIMITER $$
CREATE FUNCTION `FN_GET_PROJECT_ROLE_CODE` (
    p_user_id    BIGINT UNSIGNED,  -- 조회할 사용자 ID
    p_project_id BIGINT UNSIGNED   -- 조회할 프로젝트 ID
) RETURNS TINYINT UNSIGNED
NOT DETERMINISTIC
READS SQL DATA
COMMENT '사용자의 해당 프로젝트 활성 role_code 조회 - 배정 없으면 NULL (02_DEV_CONVENTIONS.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : FN_GET_PROJECT_ROLE_CODE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : FN_CHECK_PROJECT_ACCESS가 "배정되어 있는가"만 boolean으로 답하는 것과 달리, 이 Function은
    --        실제 role_code 값을 반환한다 - 캠페인 등 향후 도메인에서 "배정 여부"가 아니라 "그 role이
    --        CRUD 권한상 몇 단계인가"에 따라 처리 분기가 필요한 SP(예: MANAGER 이하는 즉시 처리,
    --        OPERATOR는 승인대기로 전환)를 위해 만들었다. `FN_CHECK_PROJECT_ACCESS(u,p)`는
    --        `FN_GET_PROJECT_ROLE_CODE(u,p) IS NOT NULL`과 동치이지만, 기존 SP
    --        (SP_PROJECT_API_SECRET_ROTATE)는 boolean만 필요해 그대로 두고 이 Function으로
    --        교체하지 않는다 - 이미 동작하는 코드를 건드릴 실익이 없다.
    --        SUPER_ADMIN 우회 판단은 이 Function의 책임이 아니다 - 호출하는 SP가 role_code=10이면
    --        이 Function을 아예 호출하지 않고 먼저 통과시킨다(SUPER_ADMIN은 특정 프로젝트에 매인
    --        값이 아니라 이 Function으로 표현할 수 없다). PK가 (user_id, project_id)라 활성 배정은
    --        최대 1건이므로 서브쿼리 스칼라 반환이 항상 안전하다. 활성 배정이 없으면 NULL을 반환하며,
    --        호출부가 이를 "권한 없음"으로 처리한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    RETURN (
        SELECT `role_code` FROM `user_role`
        WHERE `user_id` = p_user_id AND `project_id` = p_project_id AND `status` = 1
    );
END$$

DELIMITER ;
