-- ------------------------------------------------------------------------------------------------------------ --
-- 통합 Function 파일 — database/procedures/all_procedures.sql과 동일한 목적(로컬 개발 편의용 한 번에
-- 적용). Function 사이에는 FK/의존성이 없어 순서 제약이 없다 — 알파벳순으로 나열한다.
-- 개별 파일을 수정하면 이 파일도 반드시 함께 갱신할 것(all_tables.sql/all_procedures.sql과 동일한
-- 동기화 원칙). Procedure(`SP_`)는 database/procedures/, Function(`FN_`)은 이 폴더로 분리 보관한다
-- (2026-07-19 분리 — 접두어로만 구분하던 것을 폴더로도 구분).
-- ------------------------------------------------------------------------------------------------------------ --

-- ============================================================================================================ --
-- FN_CHECK_COMPANY_ACCESS
-- ============================================================================================================ --
DROP FUNCTION IF EXISTS `FN_CHECK_COMPANY_ACCESS`;
DELIMITER $$
CREATE FUNCTION `FN_CHECK_COMPANY_ACCESS` (
    p_user_id    BIGINT UNSIGNED,  -- 확인할 사용자 ID
    p_company_id BIGINT UNSIGNED   -- 확인할 회사 ID
) RETURNS BOOLEAN
NOT DETERMINISTIC
READS SQL DATA
COMMENT '사용자가 해당 회사 소속인지 확인 (02_DEV_CONVENTIONS.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : FN_CHECK_COMPANY_ACCESS
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : FN_CHECK_PROJECT_ACCESS/FN_GET_PROJECT_ROLE_CODE가 user_role(프로젝트 단위 배정)을
    --        보는 것과 달리, 이 Function은 user.company_id 자체를 확인한다 - DEVELOPER의 회사 단위
    --        스코핑(11_PROJECT_API.md 2.2/2.3, 12_USER_API.md 1.1~1.3처럼 "본인 소속 회사만 조회"
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

-- ============================================================================================================ --
-- FN_GET_PROJECT_ROLE_CODE
-- ============================================================================================================ --
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
    --        `FN_GET_PROJECT_ROLE_CODE(u,p) IS NOT NULL`과 동치다.
    --        2026.07.24 수정: 원래 SP_PROJECT_LIST/GET_BY_ID/API_SECRET_ROTATE는 "배정 존재
    --        여부"만 있으면 충분하다고 보고 FN_CHECK_PROJECT_ACCESS를 썼는데, 이는 role_code
    --        수준을 구분하지 못하는 결함이었다(이 프로젝트에서 OPERATOR(40)로만 배정된 사용자가
    --        다른 프로젝트에서 DEVELOPER(20)라 JWT의 MIN role_code가 20이면, 프로젝트 관리메뉴가
    --        원래 DEVELOPER 이상 전용인데도 이 프로젝트까지 조회·수정 가능해짐). 세 SP 모두 이
    --        Function으로 교체해 `role_code <= 20`까지 확인하도록 고쳤다 - "배정 여부"가 아니라
    --        "이 프로젝트에서 실제로 DEVELOPER 이상인가"가 진짜 필요한 질문이었다.
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

-- ============================================================================================================ --
-- FN_IS_SUPER_ADMIN
-- ============================================================================================================ --
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
