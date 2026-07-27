DROP FUNCTION IF EXISTS `FN_CHECK_PROJECT_ACCESS`;
DELIMITER $$
CREATE FUNCTION `FN_CHECK_PROJECT_ACCESS` (
    p_user_id    BIGINT UNSIGNED,  -- 확인할 사용자 ID
    p_project_id BIGINT UNSIGNED   -- 확인할 프로젝트 ID
) RETURNS BOOLEAN
NOT DETERMINISTIC
READS SQL DATA
COMMENT '사용자가 해당 프로젝트에 활성 user_role로 배정되어 있는지 확인 (04_DEV_CONVENTIONS.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : FN_CHECK_PROJECT_ACCESS
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user_role에 (user_id, project_id, status=1) 활성 배정이 있는지만 확인하는 재사용
    --        Function(04_DEV_CONVENTIONS.md 3.2). SUPER_ADMIN 우회 판단은 이 Function의 책임이
    --        아니다 — 호출하는 SP가 role_code를 이미 알고 있으므로, role_code=10이면 이 Function을
    --        아예 호출하지 않고 먼저 통과시킨 뒤, 그 외 role에 대해서만 호출해 실제 배정 여부를 묻는다.
    --        여러 SP(13_PROJECT_API.md 2.5, 향후 캠페인/코드/사용이력 API의 프로젝트 단위 스코핑)가
    --        동일한 이 판단을 공유한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    RETURN EXISTS (
        SELECT 1 FROM `user_role`
        WHERE `user_id` = p_user_id AND `project_id` = p_project_id AND `status` = 1
    );
END$$

DELIMITER ;
