DROP PROCEDURE IF EXISTS `SP_USER_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_GET_BY_ID` (
    IN i_user_id           BIGINT UNSIGNED,  -- 조회할 사용자 ID
    IN i_requester_user_id BIGINT UNSIGNED   -- 호출자 user_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT 'user_id로 전체 컬럼 조회, 회사 접근 재검증 - GET /auth/me, 비밀번호 변경 시 현재 해시 조회, 관리자 상세조회 공용'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : GET /auth/me, PATCH /auth/password(현재 비밀번호 검증용 해시 조회), 관리자용
    --        GET /users/{user_id}(14_USER_API.md 1.3) 세 곳에서 공용으로 쓰는 조회 SP.
    --        password_hash를 포함해 전체 컬럼을 그대로 반환하며, API 응답에 어떤 필드를 노출할지
    --        (예: password_hash 제외, phone_number 복호화)는 서비스 레이어가 결정한다.
    --        i_requester_user_id는 자기 정보 조회(auth.service.ts)에서는 항상 i_user_id와 동일한
    --        값이 들어와 FN_CHECK_COMPANY_ACCESS가 자기 자신의 company_id와 비교하게 되므로
    --        결과적으로 항상 통과한다 - 자기 정보는 role과 무관하게 항상 볼 수 있어야 하므로 이는
    --        의도된 동작이다. 관리자 조회(user.service.ts)에서는 실제 호출자와 다른 대상 user_id가
    --        들어와, DEVELOPER가 타사 사용자를 조회하면 20001로 차단한다(14_USER_API.md 1.3,
    --        앱 레이어의 1차 체크를 SP가 2차로 재검증 - 04_DEV_CONVENTIONS.md 3.2). 존재 확인
    --        (31003)이 접근 재검증보다 먼저다 - 없는 리소스는 권한 여부와 무관하게 항상 404가
    --        맞다. SUPER_ADMIN 우회는 FN_IS_SUPER_ADMIN(i_requester_user_id)로 SP가 직접 DB에서
    --        재확인한다 - 앱이 role_code 값을 별도로 넘겨 그 값을 믿는 방식은 쓰지 않는다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_company_id  BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        SELECT `company_id` INTO v_company_id FROM `user` WHERE `user_id` = i_user_id;

        IF v_company_id IS NULL THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT FN_IS_SUPER_ADMIN(i_requester_user_id)
           AND NOT FN_CHECK_COMPANY_ACCESS(i_requester_user_id, v_company_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `password_hash`,
            `user_name`, `email`, `phone_number`, `department`, `position`, `status`,
            `last_login_at`, `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;
