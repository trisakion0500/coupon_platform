DROP PROCEDURE IF EXISTS `SP_USER_SIGNUP`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SIGNUP` (
    IN i_company_id            BIGINT UNSIGNED,  -- 가입 신청 회사 ID
    IN i_requested_project_id  BIGINT UNSIGNED,  -- 가입 신청 프로젝트 ID (선택, 영구 보관, 이후 변경 불가)
    IN i_login_id              VARCHAR(100),      -- 로그인 ID
    IN i_password_hash         VARCHAR(255),      -- bcrypt 해시(앱 레이어에서 해시 완료 후 전달)
    IN i_user_name             VARCHAR(100),      -- 사용자명
    IN i_email                 VARCHAR(200),      -- 이메일
    IN i_phone_number_enc      VARCHAR(255),      -- 휴대폰번호 AES-256-CBC 암호화값(앱 레이어에서 암호화 완료 후 전달)
    IN i_department            VARCHAR(100),      -- 부서 (선택)
    IN i_position              VARCHAR(100)       -- 직급 (선택)
) COMMENT '회원가입 - status=0(가입승인대기)으로 user INSERT (09_AUTH_API.md 4장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SIGNUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회원가입 처리. company_id 존재, requested_project_id(선택 — NULL이면 검증 생략)
    --        존재 및 소속 관계를 검증하고, login_id/email 중복을 확인한 뒤
    --        status=0(가입승인대기)으로 user를 생성한다.
    --        password_hash/phone_number 암호화는 이미 앱 레이어(bcrypt/CryptoService)에서 끝난 값을
    --        그대로 저장한다 — SP는 암호화 로직을 모른다.
    --        아래 IF EXISTS 사전 체크는 일반적인 경우엔 빠르고 명확하지만 원자적이지 않다 — 동시에
    --        같은 login_id/email로 두 요청이 들어오면 둘 다 통과해버릴 수 있다. 그 드문 경쟁 상황을
    --        대비해 INSERT의 UNIQUE 제약 위반(1062) 전용 핸들러를 추가로 둬서, 사전 체크를 통과한
    --        뒤에도 실제 INSERT에서 걸리면 50001이 아니라 32001로 정확히 응답되게 한다
    --        (2026-07-19 리뷰에서 발견 — SP_NONCE_INSERT와 같은 원리).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_user_id     BIGINT       DEFAULT NULL;

    -- login_id/email 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF i_requested_project_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM `project`
            WHERE `project_id` = i_requested_project_id AND `company_id` = i_company_id
        ) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (SELECT 1 FROM `user` WHERE `login_id` = i_login_id OR `email` = i_email) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `user` (
            `company_id`, `requested_project_id`, `login_id`, `password_hash`,
            `user_name`, `email`, `phone_number`, `department`, `position`, `status`
        ) VALUES (
            i_company_id, i_requested_project_id, i_login_id, i_password_hash,
            i_user_name, i_email, i_phone_number_enc, i_department, i_position, 0
        );

        SET v_user_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`,
            `email`, `phone_number`, `department`, `position`, `status`,
            `last_login_at`, `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = v_user_id;
    END proc_block;
END$$

DELIMITER ;
