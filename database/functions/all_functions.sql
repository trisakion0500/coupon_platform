-- ------------------------------------------------------------------------------------------------------------ --
-- 통합 Function 파일 — database/procedures/all_procedures.sql과 동일한 목적(로컬 개발 편의용 한 번에
-- 적용). Function 사이에는 FK/의존성이 없어 순서 제약이 없다 — 알파벳순으로 나열한다.
-- 개별 파일을 수정하면 이 파일도 반드시 함께 갱신할 것(all_tables.sql/all_procedures.sql과 동일한
-- 동기화 원칙). Procedure(`SP_`)는 database/procedures/, Function(`FN_`)은 이 폴더로 분리 보관한다
-- (2026-07-19 분리 — 접두어로만 구분하던 것을 폴더로도 구분).
-- ------------------------------------------------------------------------------------------------------------ --

-- ============================================================================================================ --
-- FN_CHECK_PROJECT_ACCESS
-- ============================================================================================================ --
DROP FUNCTION IF EXISTS `FN_CHECK_PROJECT_ACCESS`;
DELIMITER $$
CREATE FUNCTION `FN_CHECK_PROJECT_ACCESS` (
    p_user_id    BIGINT UNSIGNED,  -- 확인할 사용자 ID
    p_project_id BIGINT UNSIGNED   -- 확인할 프로젝트 ID
) RETURNS BOOLEAN
NOT DETERMINISTIC
READS SQL DATA
COMMENT '사용자가 해당 프로젝트에 활성 user_role로 배정되어 있는지 확인 (02_DEV_CONVENTIONS.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : FN_CHECK_PROJECT_ACCESS
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user_role에 (user_id, project_id, status=1) 활성 배정이 있는지만 확인하는 재사용
    --        Function(02_DEV_CONVENTIONS.md 3.2). SUPER_ADMIN 우회 판단은 이 Function의 책임이
    --        아니다 — 호출하는 SP가 role_code를 이미 알고 있으므로, role_code=10이면 이 Function을
    --        아예 호출하지 않고 먼저 통과시킨 뒤, 그 외 role에 대해서만 호출해 실제 배정 여부를 묻는다.
    --        여러 SP(11_PROJECT_API.md 2.5, 향후 캠페인/코드/사용이력 API의 프로젝트 단위 스코핑)가
    --        동일한 이 판단을 공유한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    RETURN EXISTS (
        SELECT 1 FROM `user_role`
        WHERE `user_id` = p_user_id AND `project_id` = p_project_id AND `status` = 1
    );
END$$

DELIMITER ;
