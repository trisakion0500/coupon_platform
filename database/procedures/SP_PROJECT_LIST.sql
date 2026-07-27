DROP PROCEDURE IF EXISTS `SP_PROJECT_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_LIST` (
    IN i_company_id        BIGINT UNSIGNED,   -- 회사 필터 (NULL이면 전체) — 스코핑이 아니라 순수 필터
    IN i_status            TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_page_size         INT,               -- 페이지당 행 수
    IN i_offset            INT,               -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED    -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '프로젝트 목록 조회 - 페이지네이션, company 조인, user_role 기반 행단위 스코핑 (13_PROJECT_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 수정 : 2026.07.24 trisakion — 스코핑 기준을 회사(company_id) 단위에서 실제 user_role 배정
    --        단위로 전환. API Key/Secret처럼 민감한 자격증명을 다루는 화면이라, 같은 회사
    --        소속이라는 사실만으로 담당이 아닌 프로젝트까지 보이는 게 문제로 지적됨(캠페인 등
    --        쿠폰 도메인이 이미 쓰는 user_role 프로젝트 단위 스코핑과 통일, 19_CAMPAIGN_API.md
    --        1.2 참고). i_company_id는 더 이상 "앱이 강제로 채우는 스코핑 값"이 아니라 누구나
    --        선택적으로 쓸 수 있는 순수 필터로 의미가 바뀌었다 — SUPER_ADMIN이 아닌 호출자에게는
    --        이 필터와 별개로 `user_role` 행단위 조건이 항상 함께 걸린다. 이 방식은
    --        "권한 없음(20001)"을 던지는 대신 조용히 결과를 좁히는 필터형 스코핑이라(회사 목록
    --        조회에 잘못된 값을 넣는 것과 달리, "내가 배정 안 된 프로젝트가 안 보이는 것"은 에러가
    --        아니라 정상 동작이므로) FN_IS_SUPER_ADMIN 우회 확인 외의 별도 20001 분기가 필요 없다.
    --        FN_IS_SUPER_ADMIN 호출을 행마다 반복하지 않도록 결과를 로컬 변수에 한 번만 담아 재사용.
    -- 수정2: 2026.07.24 trisakion — 최초 전환 때는 "배정 존재 여부"만 보는 EXISTS였는데, 이는
    --        role_code 수준을 구분하지 않는 결함이었다(예: 프로젝트 A에서 DEVELOPER(20), 프로젝트
    --        B에서 OPERATOR(40)로 배정된 사용자는 JWT의 MIN role_code가 20이라 관리메뉴 진입
    --        자체는 허용되는데, 존재 여부만 보면 프로젝트 B까지 노출·수정됐다). 프로젝트 관리메뉴는
    --        DEVELOPER(20) 이상만 접근 가능하다는 원칙(12_COMPANY_API.md 1.2)을 프로젝트 단위로
    --        정확히 적용하기 위해 `role_code <= 20` 조건을 추가했다.
    -- 내용 : 프로젝트 목록을 status DESC, project_name ASC로 정렬해 페이지 단위로 반환한다.
    --        company_code/company_name을 함께 보여줘야 해서 company를 조인한다.
    --        total_count는 SP_COMPANY_LIST와 동일한 이유로 COUNT(*) OVER()가 아니라 별도 서브쿼리
    --        + LEFT JOIN ... ON TRUE 패턴으로 반환한다(offset이 범위를 벗어나 0행이 반환돼도
    --        total_count가 0으로 사라지지 않도록, 2026-07-19 감사에서 발견된 버그 수정).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state       CHAR(5)      DEFAULT '00000';
    DECLARE error_no        INT          DEFAULT 0;
    DECLARE error_message   VARCHAR(255) DEFAULT '';
    DECLARE v_is_super_admin BOOLEAN     DEFAULT FN_IS_SUPER_ADMIN(i_requester_user_id);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SELECT 0 AS RESULT;
        SELECT
            pg.`project_id`, pg.`company_id`, pg.`company_code`, pg.`company_name`,
            pg.`project_code`, pg.`project_name`, pg.`api_key`, pg.`description`,
            pg.`status`, pg.`secret_rotated_at`, pg.`created_at`, pg.`updated_at`, pg.`edit_count`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `project` p
            WHERE (i_company_id IS NULL OR p.`company_id` = i_company_id)
              AND (i_status IS NULL OR p.`status` = i_status)
              AND (
                  v_is_super_admin
                  OR EXISTS (
                      SELECT 1 FROM `user_role` ur
                      WHERE ur.`project_id` = p.`project_id`
                        AND ur.`user_id` = i_requester_user_id
                        AND ur.`status` = 1
                        AND ur.`role_code` <= 20  -- DEVELOPER(20) 이상만 — MANAGER/OPERATOR 배정은 프로젝트 관리메뉴 접근 불가
                  )
              )
        ) cnt
        LEFT JOIN (
            SELECT
                p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
                p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
                p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`, p.`edit_count`
            FROM `project` p
            JOIN `company` c ON c.`company_id` = p.`company_id`
            WHERE (i_company_id IS NULL OR p.`company_id` = i_company_id)
              AND (i_status IS NULL OR p.`status` = i_status)
              AND (
                  v_is_super_admin
                  OR EXISTS (
                      SELECT 1 FROM `user_role` ur
                      WHERE ur.`project_id` = p.`project_id`
                        AND ur.`user_id` = i_requester_user_id
                        AND ur.`status` = 1
                        AND ur.`role_code` <= 20  -- DEVELOPER(20) 이상만 — MANAGER/OPERATOR 배정은 프로젝트 관리메뉴 접근 불가
                  )
              )
            ORDER BY p.`status` DESC, p.`project_name` ASC
            LIMIT i_page_size OFFSET i_offset
        ) pg ON TRUE;
    END proc_block;
END$$

DELIMITER ;
