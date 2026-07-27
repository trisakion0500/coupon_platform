DROP FUNCTION IF EXISTS `FN_CHECK_COMPANY_ACCESS`;
DELIMITER $$
CREATE FUNCTION `FN_CHECK_COMPANY_ACCESS` (
    p_user_id    BIGINT UNSIGNED,  -- 확인할 사용자 ID
    p_company_id BIGINT UNSIGNED   -- 확인할 회사 ID
) RETURNS BOOLEAN
NOT DETERMINISTIC
READS SQL DATA
COMMENT '사용자가 해당 회사 소속인지 확인 (04_DEV_CONVENTIONS.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : FN_CHECK_COMPANY_ACCESS
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : FN_CHECK_PROJECT_ACCESS/FN_GET_PROJECT_ROLE_CODE가 user_role(프로젝트 단위 배정)을
    --        보는 것과 달리, 이 Function은 user.company_id 자체를 확인한다 - DEVELOPER의 회사 단위
    --        스코핑(13_PROJECT_API.md 2.2/2.3, 14_USER_API.md 1.1~1.3처럼 "본인 소속 회사만 조회"
    --        규칙)은 프로젝트 배정과 무관하게 user 테이블의 company_id 하나로 판단되기 때문에
    --        user_role을 조인할 필요가 없다. 지금까지 이 스코핑은 앱(TypeScript) 서비스 레이어에서만
    --        검증했는데, SP 호출자의 회사 접근 권한을 SP 자신도 재검증하도록(방어적 이중 체크)
    --        SP_PROJECT_LIST/GET_BY_ID, SP_USER_LIST/GET_BY_ID에 적용한다. SUPER_ADMIN 우회는 이
    --        Function의 책임이 아니다 - 호출 SP가 role_code=10이면 먼저 통과시키고 그 외에만 호출한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    RETURN EXISTS (
        SELECT 1 FROM `user`
        WHERE `user_id` = p_user_id AND `company_id` = p_company_id
    );
END$$

DELIMITER ;
