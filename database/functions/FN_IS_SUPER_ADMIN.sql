DROP FUNCTION IF EXISTS `FN_IS_SUPER_ADMIN`;
DELIMITER $$
CREATE FUNCTION `FN_IS_SUPER_ADMIN` (
    p_user_id BIGINT UNSIGNED  -- 확인할 사용자 ID
) RETURNS BOOLEAN
NOT DETERMINISTIC
READS SQL DATA
COMMENT '사용자가 활성 SUPER_ADMIN(role_code=10) 배정을 가지고 있는지 확인 (02_DEV_CONVENTIONS.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : FN_IS_SUPER_ADMIN
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : SP_USER_GET_BY_LOGIN_ID가 로그인 시 role_code를 `COALESCE(MIN(role_code), 40)`으로
    --        계산하는 것과 동일한 원칙 - user_role에 role_code=10인 활성(status=1) 배정이
    --        하나라도 있으면 SUPER_ADMIN이다(SUPER_ADMIN은 특정 프로젝트에 매이지 않으므로
    --        project_id 조건 없이 user_id만으로 판단). SUPER_ADMIN 전용 SP(예: SP_COMPANY_CREATE)
    --        가 호출자의 role_code=10 여부를 앱(JWT 페이로드) 전달값에만 의존하지 않고 SP 스스로
    --        DB에서 재확인하기 위해 만들었다 - FN_CHECK_COMPANY_ACCESS/FN_CHECK_PROJECT_ACCESS와
    --        달리 이 Function 자체가 SUPER_ADMIN 판별을 담당하므로, 호출 SP는 "role_code=10이면
    --        건너뛴다" 같은 우회 로직 없이 이 Function의 반환값을 그대로 권한 판단에 쓴다.
    -- ------------------------------------------------------------------------------------------------------------ --
    RETURN EXISTS (
        SELECT 1 FROM `user_role`
        WHERE `user_id` = p_user_id AND `role_code` = 10 AND `status` = 1
    );
END$$

DELIMITER ;
