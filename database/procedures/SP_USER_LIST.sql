DROP PROCEDURE IF EXISTS `SP_USER_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_LIST` (
    IN i_company_id        BIGINT UNSIGNED,  -- 회사 ID 필터 (NULL이면 전체 - SUPER_ADMIN 전용, DEVELOPER는 서비스가 항상 자기 회사로 고정)
    IN i_status            TINYINT UNSIGNED, -- 상태 필터 (NULL이면 전체)
    IN i_limit             INT,              -- 페이지당 행 수
    IN i_offset            INT,              -- 시작 오프셋
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '사용자 목록 조회 - status ASC 정렬, 회사 접근 재검증 (14_USER_API.md 1.1/1.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id/status 조건부 필터 + 페이지네이션. company.sql/project.sql과 동일하게
    --        별도 COUNT 서브쿼리 + LEFT JOIN ... ON TRUE로 total_count를 반환해 RESULT+data
    --        2-result-set 규약을 유지한다(COUNT(*) OVER()는 offset이 범위를 벗어나 0행이 반환되면
    --        total_count도 0으로 사라지는 버그가 있어 2026-07-19 이 패턴으로 교체).
    --        다른 테이블은 status DESC가 기본이지만 user는 "가입승인대기(0)"가 가장 먼저 보여야
    --        하는 화면 요구사항이 있어 status ASC로 정렬한다(14_USER_API.md 1.1 Sorting, 다른
    --        도메인과 다른 정렬 방향이라는 점을 주석으로 명시).
    --        password_hash는 반환 컬럼에서 제외한다 — 목록/상세 어디서도 앱으로 내보낼 이유가 없다.
    --        DEVELOPER의 회사 단위 스코핑은 앱 레이어(UserService)가 i_company_id에 항상 자기
    --        companyId를 채워 호출하는 방식으로 1차 강제하고, 이 SP도 FN_CHECK_COMPANY_ACCESS로
    --        호출자가 실제 그 회사 소속인지 2차로 재검증한다(방어적 이중 체크,
    --        04_DEV_CONVENTIONS.md 3.2). SUPER_ADMIN 우회는 FN_IS_SUPER_ADMIN(i_requester_user_id)로
    --        SP가 직접 DB에서 재확인한다 - 앱이 넘긴 role_code 값을 그대로 믿지 않는다.
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

    proc_block: BEGIN
        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_COMPANY_ACCESS(i_requester_user_id, i_company_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`user_id`, p.`company_id`, p.`requested_project_id`, p.`login_id`, p.`user_name`, p.`email`,
            p.`phone_number`, p.`department`, p.`position`, p.`status`, p.`last_login_at`,
            p.`created_at`, p.`updated_at`,
            cnt.`total_count`
        FROM (
            SELECT COUNT(*) AS total_count
            FROM `user`
            WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
              AND (i_status IS NULL OR `status` = i_status)
        ) cnt
        LEFT JOIN (
            SELECT
                `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
                `phone_number`, `department`, `position`, `status`, `last_login_at`,
                `created_at`, `updated_at`
            FROM `user`
            WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
              AND (i_status IS NULL OR `status` = i_status)
            ORDER BY `status` ASC, `user_name` ASC
            LIMIT i_limit OFFSET i_offset
        ) p ON TRUE;
    END proc_block;
END$$

DELIMITER ;
