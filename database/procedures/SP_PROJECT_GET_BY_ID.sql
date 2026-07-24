DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_ID` (
    IN i_project_id        BIGINT UNSIGNED,  -- 조회할 프로젝트 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 상세 조회 - company 조인, user_role 배정 재검증 (11_PROJECT_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 수정 : 2026.07.24 trisakion — 접근 판단 기준을 "호출자가 이 프로젝트의 회사 소속인가"
    --        (FN_CHECK_COMPANY_ACCESS)에서 "호출자가 이 프로젝트에 실제 활성 user_role로
    --        배정되어 있는가"(FN_CHECK_PROJECT_ACCESS)로 전환 — SP_PROJECT_LIST와 동일한 이유
    --        (2026-07-24 수정 참고), API Secret 재발급(SP_PROJECT_API_SECRET_ROTATE)이 이미
    --        FN_CHECK_PROJECT_ACCESS를 쓰고 있어 이번 변경으로 조회/재발급 두 엔드포인트의
    --        접근 기준이 비로소 일치한다.
    -- 수정2: 2026.07.24 trisakion — FN_CHECK_PROJECT_ACCESS는 배정 "존재 여부"만 boolean으로
    --        답해 role_code 수준을 구분하지 못했다(예: 이 프로젝트에서 OPERATOR(40)로만 배정된
    --        사용자가 다른 프로젝트에서 DEVELOPER(20)라 JWT의 MIN role_code가 20이면, 관리메뉴
    --        진입 자체는 허용되니 이 프로젝트 상세까지 조회·재발급 가능해지는 결함). 프로젝트
    --        관리메뉴는 DEVELOPER(20) 이상만 접근 가능하다는 원칙(10_COMPANY_API.md 1.2)을
    --        프로젝트 단위로 정확히 적용하기 위해 FN_GET_PROJECT_ROLE_CODE로 실제 role_code
    --        값을 가져와 20 이하인지까지 확인하도록 교체했다.
    -- 내용 : project_id로 프로젝트 상세를 조회한다. company_code/company_name을 함께 반환하기
    --        위해 company를 조인한다. 없으면 31002. DEVELOPER 미만 배정/미배정 프로젝트 접근
    --        차단(20001)은 앱 레이어(ProjectService)가 아니라 이 SP가 유일한 방어선이다(회사
    --        매칭과 달리 user_role 배정 여부/role_code 값은 앱이 JWT만으로 판단할 수 없는
    --        정보라, 02_DEV_CONVENTIONS.md 3.2의 "호출자가 이미 알고 있는 값은 앱이 먼저 걸러도
    --        된다"는 예외에 해당하지 않음 — campaign 도메인의 getById와 동일한 패턴). 존재
    --        확인이 먼저이고(31002), 그 다음 접근 재검증(20001) 순서다 - 없는 리소스는 권한
    --        여부와 무관하게 항상 404가 맞다. SUPER_ADMIN 우회는 FN_IS_SUPER_ADMIN
    --        (i_requester_user_id)로 SP가 직접 DB에서 재확인한다 - 앱이 넘긴 role_code 값을
    --        그대로 믿지 않는다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_exists      TINYINT UNSIGNED DEFAULT 0;
    DECLARE v_role_code   TINYINT UNSIGNED DEFAULT NULL;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SELECT COUNT(*) INTO v_exists FROM `project` WHERE `project_id` = i_project_id;

        IF v_exists = 0 THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id) THEN
            SET v_role_code = FN_GET_PROJECT_ROLE_CODE(i_requester_user_id, i_project_id);
            IF v_role_code IS NULL OR v_role_code > 20 THEN
                SELECT 20001 AS RESULT;
                LEAVE proc_block;
            END IF;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
            p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
            p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`, p.`edit_count`
        FROM `project` p
        JOIN `company` c ON c.`company_id` = p.`company_id`
        WHERE p.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;
