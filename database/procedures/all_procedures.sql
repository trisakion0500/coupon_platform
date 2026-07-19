-- ------------------------------------------------------------------------------------------------------------ --
-- 통합 SP/Function 파일 — database/tables/all_tables.sql과 동일한 목적(로컬 개발 편의용 한 번에 적용).
-- 테이블과 달리 SP 사이에는 FK 의존성이 없어 순서 제약이 없다 — 알파벳순으로 나열한다.
-- 개별 파일을 수정하면 이 파일도 반드시 함께 갱신할 것(all_tables.sql과 동일한 동기화 원칙).
-- ------------------------------------------------------------------------------------------------------------ --

-- ============================================================================================================ --
-- SP_COMPANY_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_CREATE` (
    IN i_company_code VARCHAR(20),   -- 회사 코드 (전역 UNIQUE)
    IN i_company_name VARCHAR(100),  -- 회사명
    IN i_description  VARCHAR(1000)  -- 설명 (선택)
) COMMENT '회사 생성 - company_code 중복 확인 후 INSERT (10_COMPANY_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 생성. company_code 중복을 사전 체크(32001)한 뒤 INSERT한다. SP_USER_SIGNUP과
    --        동일한 이유로 사전 체크는 원자적이지 않으므로(동시에 같은 code로 두 요청이 들어오면
    --        둘 다 통과할 수 있음), INSERT의 UNIQUE 제약 위반(1062) 전용 핸들러를 백스톱으로 둔다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_company_id  BIGINT       DEFAULT NULL;

    -- company_code 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
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
        IF EXISTS (SELECT 1 FROM `company` WHERE `company_code` = i_company_code) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `company` (`company_code`, `company_name`, `description`)
        VALUES (i_company_code, i_company_name, i_description);

        SET v_company_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `company_id`, `company_code`, `company_name`, `description`,
            `status`, `created_at`, `updated_at`
        FROM `company`
        WHERE `company_id` = v_company_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_GET_ACTIVE_HEADER_DATA
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_ACTIVE_HEADER_DATA`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_ACTIVE_HEADER_DATA` (
    IN i_user_id    BIGINT UNSIGNED,  -- 요청자 user_id (JWT 페이로드 값 그대로 신뢰)
    IN i_role_code  TINYINT UNSIGNED, -- 요청자 role_code (JWT 페이로드 값 그대로 신뢰)
    IN i_company_id BIGINT UNSIGNED   -- 요청자 소속 company_id (JWT 페이로드 값 그대로 신뢰)
) COMMENT '헤더 콤보박스용 활성 회사/프로젝트 조회 (10_COMPANY_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_ACTIVE_HEADER_DATA
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인 직후 헤더 콤보박스가 1회 로드하는 활성 회사·프로젝트 목록.
    --        role_code=10(SUPER_ADMIN)이면 전체 활성 회사+프로젝트, 그 외에는 본인 소속 회사 1건과
    --        user_role에 활성 배정(status=1)된 프로젝트만 반환한다 — 같은 회사 소속이어도 role
    --        미배정 프로젝트는 제외한다(10_COMPANY_API.md 3.1 Business Rules).
    --        role_code/company_id는 JwtAuthGuard가 검증한 JWT 페이로드 값을 그대로 신뢰하고 DB를
    --        재조회하지 않는다(jwt-auth.guard.ts와 같은 원칙, 로그인/재발급 시점에만 재계산됨).
    --        02_DEV_CONVENTIONS.md 3.4의 RESULT SELECT 규약은 RESULT + data 정확히 2개 result set만
    --        허용하므로, company/project를 각각 별도 result set으로 반환하는 대신 row_type
    --        판별 컬럼('COMPANY'/'PROJECT')으로 하나의 result set에 함께 담는다 — 서비스 레이어
    --        (company.service.ts)에서 row_type으로 다시 분리해 {companies, projects} 형태로 조립한다.
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

    SELECT 0 AS RESULT;

    IF i_role_code = 10 THEN
        SELECT 'COMPANY' AS row_type, `company_id` AS id, `company_id` AS company_id, `company_name` AS name
        FROM `company`
        WHERE `status` = 1
        UNION ALL
        SELECT 'PROJECT' AS row_type, `project_id` AS id, `company_id` AS company_id, `project_name` AS name
        FROM `project`
        WHERE `status` = 1;
    ELSE
        SELECT 'COMPANY' AS row_type, `company_id` AS id, `company_id` AS company_id, `company_name` AS name
        FROM `company`
        WHERE `company_id` = i_company_id AND `status` = 1
        UNION ALL
        SELECT 'PROJECT' AS row_type, p.`project_id` AS id, p.`company_id` AS company_id, p.`project_name` AS name
        FROM `project` p
        INNER JOIN `user_role` ur ON ur.`project_id` = p.`project_id`
        WHERE ur.`user_id` = i_user_id AND ur.`status` = 1 AND p.`status` = 1;
    END IF;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_GET_BY_CODE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_BY_CODE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_BY_CODE` (
    IN i_company_code VARCHAR(20)  -- 조회할 회사 코드
) COMMENT '회사 코드로 조회 - 회원가입 화면 전용 공개 API (10_COMPANY_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_BY_CODE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회원가입 화면(로그인 전, 인증 불필요)에서 company_code로 회사를 찾기 위한 공개 조회.
    --        status=1(사용)인 회사만 대상으로 하고, company_id/company_name만 반환한다 —
    --        민감정보(description 등)는 노출하지 않는다. 없거나 비활성이면 31001.
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
        IF NOT EXISTS (
            SELECT 1 FROM `company` WHERE `company_code` = i_company_code AND `status` = 1
        ) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `company_id`, `company_name`
        FROM `company`
        WHERE `company_code` = i_company_code AND `status` = 1;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_GET_BY_ID` (
    IN i_company_id BIGINT UNSIGNED  -- 조회할 회사 ID
) COMMENT '회사 상세 조회 (10_COMPANY_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id로 회사 상세를 조회한다. 없으면 31001.
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
        IF NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = i_company_id) THEN
            SELECT 31001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `company_id`, `company_code`, `company_name`, `description`,
            `status`, `created_at`, `updated_at`
        FROM `company`
        WHERE `company_id` = i_company_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_LIST` (
    IN i_status    TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_page_size INT,               -- 페이지당 행 수
    IN i_offset    INT                -- 시작 오프셋
) COMMENT '회사 목록 조회 - 페이지네이션 (10_COMPANY_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 목록을 status DESC, company_name ASC로 정렬해 페이지 단위로 반환한다.
    --        02_DEV_CONVENTIONS.md 3.4의 RESULT SELECT 규약은 RESULT + data 정확히 2개 result set만
    --        허용하므로, 별도의 COUNT(*) 쿼리를 셋째 result set으로 추가하는 대신 COUNT(*) OVER()
    --        윈도우 함수로 총 개수를 data의 각 행에 함께 실어보낸다 — 페이지네이션이 필요한 다른
    --        목록 SP(project/user 등)도 이 패턴을 그대로 재사용한다.
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

    SELECT 0 AS RESULT;
    SELECT
        `company_id`, `company_code`, `company_name`, `description`,
        `status`, `created_at`, `updated_at`,
        COUNT(*) OVER() AS total_count
    FROM `company`
    WHERE i_status IS NULL OR `status` = i_status
    ORDER BY `status` DESC, `company_name` ASC
    LIMIT i_page_size OFFSET i_offset;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_COMPANY_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_COMPANY_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_COMPANY_UPDATE` (
    IN i_company_id   BIGINT UNSIGNED,  -- 수정할 회사 ID
    IN i_company_code VARCHAR(20),      -- 새 회사 코드 (NULL이면 미변경)
    IN i_company_name VARCHAR(100),     -- 새 회사명 (NULL이면 미변경)
    IN i_description  VARCHAR(1000),    -- 새 설명 (NULL이면 미변경)
    IN i_status       TINYINT UNSIGNED  -- 새 상태 (NULL이면 미변경)
) COMMENT '회사 수정 - 조건부 UPDATE (10_COMPANY_API.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_COMPANY_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회사 정보 수정. 존재 확인(31001) -> company_code 변경 시 중복 확인(자기 자신 제외, 32001)
    --        -> COALESCE 기반 조건부 UPDATE(02_DEV_CONVENTIONS.md 4장)로 NULL로 넘어온 필드는 기존
    --        값을 유지한다. 관리자 폼이 매번 전체 필드를 채워 보내는 단순 CRUD라 "필드를 명시적으로
    --        NULL로 비우는" 시나리오까지는 다루지 않는다(description을 지우고 싶으면 빈 문자열을
    --        보내는 것으로 충분 — 실제 NULL 저장이 필요해지면 그때 별도 플래그를 추가한다).
    --        SP_COMPANY_CREATE와 동일한 이유로, 사전 중복확인 -> UPDATE 사이에 다른 트랜잭션이
    --        같은 company_code로 끼어드는 경쟁 상태에 대비해 UNIQUE 제약 위반(1062) 백스톱
    --        핸들러를 둔다(2026-07-19 리뷰에서 CREATE에만 있고 UPDATE에는 없던 것을 발견).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    -- company_code 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
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

        IF i_company_code IS NOT NULL AND EXISTS (
            SELECT 1 FROM `company`
            WHERE `company_code` = i_company_code AND `company_id` <> i_company_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `company`
        SET
            `company_code` = COALESCE(i_company_code, `company_code`),
            `company_name` = COALESCE(i_company_name, `company_name`),
            `description`  = COALESCE(i_description, `description`),
            `status`       = COALESCE(i_status, `status`)
        WHERE `company_id` = i_company_id;

        SELECT 0 AS RESULT;
        SELECT
            `company_id`, `company_code`, `company_name`, `description`,
            `status`, `created_at`, `updated_at`
        FROM `company`
        WHERE `company_id` = i_company_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_NONCE_INSERT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_NONCE_INSERT`;
DELIMITER $$
CREATE PROCEDURE `SP_NONCE_INSERT` (
    IN i_project_id BIGINT UNSIGNED,  -- 인증된 project_id (project.project_id)
    IN i_nonce      VARCHAR(64)       -- X-API-Nonce 헤더 원문
) COMMENT 'S2S nonce 원자적 등록 — UNIQUE 위반이면 재전송으로 판단해 10015 반환(docs/07_AUTH_SECURITY.md 2.4 6번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_NONCE_INSERT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : S2S 인증 가드(docs/07_AUTH_SECURITY.md 2.4 6번)의 재전송 방지 nonce 등록.
    --        (project_id, nonce) UNIQUE 제약 위반을 "이미 사용된 nonce(재전송 의심)"으로 판단해 10015를
    --        반환한다. 02_DEV_CONVENTIONS.md 3.4는 "예측 가능한 실패는 예외로 던지지 않는다"는 원칙이지만
    --        이 SP는 의도적 예외다 — INSERT 자체의 원자적 유니크 제약 위반을 이용해야만 동시에 같은 nonce가
    --        들어와도 정확히 하나만 성공시킬 수 있다(체크 후 INSERT는 두 요청이 동시에 통과하는 경쟁 상태를
    --        막지 못함, docs/07_AUTH_SECURITY.md 2.5 참고).
    --        MySQL은 여러 핸들러가 매치될 때 선언 순서와 무관하게 더 구체적인 조건(mysql_errno)을
    --        SQLEXCEPTION 같은 범용 조건보다 우선 적용하므로, 1062 전용 핸들러가 항상 먼저 걸린다 —
    --        아래에서 먼저 선언한 것은 가독성을 위한 것일 뿐, 동작상 필수는 아니다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    -- 유니크 제약(재전송) 전용 핸들러 — mysql_errno 1062(ER_DUP_ENTRY)
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 10015 AS RESULT;
    END;

    -- 그 외 예측 못한 시스템 오류
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    INSERT INTO `project_api_nonce` (`project_id`, `nonce`)
    VALUES (i_project_id, i_nonce);

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_API_SECRET_CLEANUP
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_API_SECRET_CLEANUP`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_API_SECRET_CLEANUP` (
    IN i_grace_period_days INT UNSIGNED  -- 유예기간(일) — API_SECRET_GRACE_PERIOD_DAYS
) COMMENT '유예기간 지난 api_secret_prev 정리 배치 (07_AUTH_SECURITY.md 2.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_API_SECRET_CLEANUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : Secret Rotation Grace Period 방식(07_AUTH_SECURITY.md 2.6)의 정리 배치.
    --        secret_rotated_at + i_grace_period_days가 지난 행의 api_secret_prev를 NULL
    --        처리한다 — 그 이후에는 이전 Secret으로 서명해도 더 이상 통과시키지 않는다
    --        (S2sAuthGuard.verifySignature가 api_secret_prev가 NULL이면 아예 후보에서 제외).
    --        SP_SESSION_CLEANUP과 동일하게 서버 기동 시 ApiSecretCleanupService가 크론으로 호출한다.
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

    UPDATE `project`
    SET `api_secret_prev` = NULL
    WHERE `api_secret_prev` IS NOT NULL
      AND `secret_rotated_at` IS NOT NULL
      AND `secret_rotated_at` <= NOW() - INTERVAL i_grace_period_days DAY;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_API_SECRET_ROTATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_API_SECRET_ROTATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_API_SECRET_ROTATE` (
    IN i_project_id      BIGINT UNSIGNED,  -- 재발급 대상 프로젝트 ID
    IN i_user_id         BIGINT UNSIGNED,  -- 요청자 user_id (JWT 페이로드 값 그대로 신뢰)
    IN i_role_code       TINYINT UNSIGNED, -- 요청자 role_code (JWT 페이로드 값 그대로 신뢰)
    IN i_new_api_secret_enc VARCHAR(255)   -- 새 API Secret AES-256-CBC 암호화값 (앱 레이어에서 암호화 완료)
) COMMENT 'API Secret 재발급 - Grace Period 방식 (11_PROJECT_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_API_SECRET_ROTATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 존재 확인(31002) 후, role_code=10(SUPER_ADMIN)이 아니면 FN_CHECK_PROJECT_ACCESS로
    --        해당 project_id에 실제 활성 user_role 배정이 있는지 재검증한다(11_PROJECT_API.md 2.5
    --        Business Rules — JWT의 role_code는 여러 프로젝트 중 최고 권한 하나뿐이라 이 project_id
    --        기준으로는 다시 확인해야 함). 통과하면 기존 api_secret을 api_secret_prev로 옮기고
    --        신규 값을 api_secret에 저장, secret_rotated_at을 갱신한다(07_AUTH_SECURITY.md 2.6
    --        Grace Period 방식). api_key는 변경하지 않는다. 반환 컬럼에 api_secret(암호문)은
    --        포함하지 않는다 — 평문은 앱 레이어가 자신이 생성한 값을 응답에 직접 얹는다.
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
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF i_role_code <> 10 AND NOT FN_CHECK_PROJECT_ACCESS(i_user_id, i_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `project`
        SET
            `api_secret_prev`   = `api_secret`,
            `api_secret`        = i_new_api_secret_enc,
            `secret_rotated_at` = NOW()
        WHERE `project_id` = i_project_id;

        SELECT 0 AS RESULT;
        SELECT `project_id`, `secret_rotated_at`
        FROM `project`
        WHERE `project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_CREATE` (
    IN i_company_id     BIGINT UNSIGNED,  -- 소속 회사 ID
    IN i_project_code   VARCHAR(20),      -- 프로젝트 코드 (company_id 범위 내 UNIQUE)
    IN i_project_name   VARCHAR(100),     -- 프로젝트명
    IN i_description     VARCHAR(1000),   -- 설명 (선택)
    IN i_api_key         VARCHAR(64),     -- 서버간 호출용 API Key (앱 레이어에서 생성)
    IN i_api_secret_enc  VARCHAR(255)     -- API Secret AES-256-CBC 암호화값 (앱 레이어에서 암호화 완료)
) COMMENT '프로젝트 생성 - api_key/api_secret 발급 후 INSERT (11_PROJECT_API.md 2.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 생성. company_id 존재(31001) 확인 후 company_id 범위 내 project_code
    --        중복(32001)을 사전 체크한 뒤 INSERT한다. api_key/api_secret은 이미 앱 레이어
    --        (ProjectService)에서 생성/암호화가 끝난 값을 그대로 저장한다 — SP는 암호화 로직을
    --        모른다(SP_USER_SIGNUP과 동일한 원칙). 사전 체크는 원자적이지 않으므로 INSERT의
    --        UNIQUE 제약 위반(1062, project_code 또는 api_key 어느 쪽이든)도 32001로 통일해
    --        백스톱한다 — api_key는 256비트 난수라 충돌 가능성이 사실상 0에 가까워 별도 코드로
    --        구분하지 않는다.
    --        반환 컬럼에 api_secret(암호문)은 포함하지 않는다 — 앱으로 다시 내보낼 이유가 없고,
    --        평문은 서비스 레이어가 자신이 생성한 값을 응답에 직접 얹는다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_project_id  BIGINT       DEFAULT NULL;

    -- project_code/api_key 유니크 제약 위반(경쟁 상태 백스톱) — mysql_errno 1062
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

        IF EXISTS (
            SELECT 1 FROM `project`
            WHERE `company_id` = i_company_id AND `project_code` = i_project_code
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `project` (
            `company_id`, `project_code`, `project_name`, `description`, `api_key`, `api_secret`
        ) VALUES (
            i_company_id, i_project_code, i_project_name, i_description, i_api_key, i_api_secret_enc
        );

        SET v_project_id = LAST_INSERT_ID();

        SELECT 0 AS RESULT;
        SELECT
            `project_id`, `company_id`, `project_code`, `project_name`, `description`,
            `api_key`, `status`, `created_at`, `updated_at`
        FROM `project`
        WHERE `project_id` = v_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_GET_BY_API_KEY
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_API_KEY`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_API_KEY` (
    IN i_api_key VARCHAR(64)  -- 조회할 API Key (project.api_key)
) COMMENT 'API Key로 project 조회 (S2S 인증 가드 전용, docs/07_AUTH_SECURITY.md 2.4 3~4번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_API_KEY
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : S2S 인증 가드(docs/07_AUTH_SECURITY.md 2.4 3~4번)가 X-API-Key로 project를 조회할 때 사용.
    --        RESULT SELECT 규약(docs/02_DEV_CONVENTIONS.md 3.4)을 따른다 — 첫 SELECT는 RESULT 단일 행,
    --        성공(0)일 때만 두 번째 SELECT로 project 행(암호화된 api_secret/api_secret_prev 포함)을 반환한다.
    --        프로젝트 상태(status=0 중지)는 이 SP에서 판단하지 않는다 — "코드 없음(31002)"과
    --        "상태 불가(10014)"는 서로 다른 result 코드라, 조회 자체는 그대로 성공시키고 상태 확인은
    --        가드 쪽에서 조회된 값을 보고 별도로 매핑한다.
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
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `api_key` = i_api_key) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `project_id`,
            `status`,
            `api_secret`,
            `api_secret_prev`,
            `secret_rotated_at`
        FROM `project`
        WHERE `api_key` = i_api_key;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_GET_BY_CODE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_CODE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_CODE` (
    IN i_company_id   BIGINT UNSIGNED,  -- 조회할 회사 ID
    IN i_project_code VARCHAR(20)       -- 조회할 프로젝트 코드
) COMMENT '회사 범위 내 프로젝트 코드로 조회 - 회원가입 화면 전용 공개 API (11_PROJECT_API.md 2.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_CODE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 회원가입 화면(로그인 전, 인증 불필요)에서 (company_id, project_code)로 프로젝트를
    --        찾기 위한 공개 조회. status=1(사용)인 것만 대상으로 하고, project_id/project_name만
    --        반환한다(민감정보 없음). 없거나 비활성이면 31002.
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
        IF NOT EXISTS (
            SELECT 1 FROM `project`
            WHERE `company_id` = i_company_id AND `project_code` = i_project_code AND `status` = 1
        ) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT `project_id`, `project_name`
        FROM `project`
        WHERE `company_id` = i_company_id AND `project_code` = i_project_code AND `status` = 1;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_GET_BY_ID` (
    IN i_project_id BIGINT UNSIGNED  -- 조회할 프로젝트 ID
) COMMENT '프로젝트 상세 조회 - company 조인 (11_PROJECT_API.md 2.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : project_id로 프로젝트 상세를 조회한다. company_code/company_name을 함께 반환하기
    --        위해 company를 조인한다. 없으면 31002. DEVELOPER의 타사 프로젝트 접근 차단(20001)은
    --        여기서 판단하지 않는다 — 앱 레이어(ProjectService)가 조회 결과의 company_id를
    --        요청자의 companyId와 비교해 판단한다(이 SP는 SUPER_ADMIN/DEVELOPER 구분을 모른다).
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
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
            p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
            p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`
        FROM `project` p
        JOIN `company` c ON c.`company_id` = p.`company_id`
        WHERE p.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_LIST` (
    IN i_company_id BIGINT UNSIGNED,   -- 회사 필터 (NULL이면 전체 — DEVELOPER 호출 시 앱 레이어가 자기 회사로 강제)
    IN i_status     TINYINT UNSIGNED,  -- 상태 필터 (NULL이면 전체)
    IN i_page_size  INT,               -- 페이지당 행 수
    IN i_offset     INT                -- 시작 오프셋
) COMMENT '프로젝트 목록 조회 - 페이지네이션, company 조인 (11_PROJECT_API.md 2.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 목록을 status DESC, project_name ASC로 정렬해 페이지 단위로 반환한다.
    --        company_code/company_name을 함께 보여줘야 해서 company를 조인한다. DEVELOPER는
    --        본인 소속 company_id만 봐야 하는데(11_PROJECT_API.md 2.2 Business Rules), 그 스코핑은
    --        앱 레이어(ProjectService)가 i_company_id에 항상 자기 companyId를 채워 호출하는
    --        방식으로 강제한다 — SP는 SUPER_ADMIN/DEVELOPER 구분을 모르고 그냥 필터만 적용한다.
    --        total_count는 SP_COMPANY_LIST와 동일하게 COUNT(*) OVER()로 함께 반환한다.
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

    SELECT 0 AS RESULT;
    SELECT
        p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
        p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
        p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`,
        COUNT(*) OVER() AS total_count
    FROM `project` p
    JOIN `company` c ON c.`company_id` = p.`company_id`
    WHERE (i_company_id IS NULL OR p.`company_id` = i_company_id)
      AND (i_status IS NULL OR p.`status` = i_status)
    ORDER BY p.`status` DESC, p.`project_name` ASC
    LIMIT i_page_size OFFSET i_offset;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_PROJECT_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_PROJECT_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_UPDATE` (
    IN i_project_id   BIGINT UNSIGNED,  -- 수정할 프로젝트 ID
    IN i_project_name VARCHAR(100),     -- 새 프로젝트명 (NULL이면 미변경)
    IN i_description  VARCHAR(1000),    -- 새 설명 (NULL이면 미변경)
    IN i_status       TINYINT UNSIGNED  -- 새 상태 (NULL이면 미변경)
) COMMENT '프로젝트 수정 - 조건부 UPDATE (11_PROJECT_API.md 2.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 프로젝트 정보 수정. company_id/project_code/api_key/api_secret은 이 SP의 파라미터에
    --        아예 없다 — 생성 후 변경 불가 필드라 애초에 받지 않는다(11_PROJECT_API.md 2.4
    --        Non-Updatable Fields). 존재 확인(31002) -> COALESCE 기반 조건부 UPDATE
    --        (02_DEV_CONVENTIONS.md 4장)로 NULL로 넘어온 필드는 기존 값을 유지한다.
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
        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `project`
        SET
            `project_name` = COALESCE(i_project_name, `project_name`),
            `description`  = COALESCE(i_description, `description`),
            `status`       = COALESCE(i_status, `status`)
        WHERE `project_id` = i_project_id;

        SELECT 0 AS RESULT;
        SELECT
            p.`project_id`, p.`company_id`, c.`company_code`, c.`company_name`,
            p.`project_code`, p.`project_name`, p.`api_key`, p.`description`,
            p.`status`, p.`secret_rotated_at`, p.`created_at`, p.`updated_at`
        FROM `project` p
        JOIN `company` c ON c.`company_id` = p.`company_id`
        WHERE p.`project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_SESSION_CLEANUP
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_SESSION_CLEANUP`;
DELIMITER $$
CREATE PROCEDURE `SP_SESSION_CLEANUP` () COMMENT '만료 세션 물리 삭제 배치 (08_API_COMMON.md 5.4, SESSION_CLEANUP_CRON)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_SESSION_CLEANUP
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : expired_at이 현재 시각보다 과거인 세션을 status와 무관하게 물리 삭제한다.
    --        만료 기간 값(JWT_REFRESH_EXPIRES_IN) 자체를 몰라도 되도록 expired_at은 로그인 시점에
    --        이미 절대시각으로 저장돼 있어(SP_USER_SESSION_CREATE), NOW()와 비교만 하면 된다.
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

    DELETE FROM `user_session` WHERE `expired_at` < NOW();

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_APPROVE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_APPROVE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_APPROVE` (
    IN i_user_id BIGINT UNSIGNED  -- 승인할 사용자 ID
) COMMENT '가입승인 - status 0(대기) -> 1(승인) 조건부 UPDATE (12_USER_API.md 1.4)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_APPROVE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 조건부 UPDATE(WHERE status=0)를 먼저 시도해 체크 후 갱신(check-then-act) 대신
    --        원자적으로 처리한다(02_DEV_CONVENTIONS.md 4장). 영향받은 행이 0건일 때만 그 이유를
    --        진단한다 - 사용자 자체가 없으면 31003, 있는데 이미 status=0이 아니면(이미 처리됨)
    --        30004(상태 전이 불가)로 구분한다. 이렇게 하면 성공 경로(가장 흔한 경우)는 존재
    --        여부를 별도로 조회하지 않고 UPDATE 한 번으로 끝난다.
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
        UPDATE `user`
        SET `status` = 1
        WHERE `user_id` = i_user_id AND `status` = 0;

        IF ROW_COUNT() = 0 THEN
            IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
                SELECT 31003 AS RESULT;
            ELSE
                SELECT 30004 AS RESULT;
            END IF;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_GET_BY_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_GET_BY_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_GET_BY_ID` (
    IN i_user_id BIGINT UNSIGNED  -- 조회할 사용자 ID
) COMMENT 'user_id로 전체 컬럼 조회 - GET /auth/me, 비밀번호 변경 시 현재 해시 조회 공용'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_GET_BY_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : GET /auth/me와 PATCH /auth/password(현재 비밀번호 검증용 해시 조회) 양쪽에서
    --        공용으로 쓰는 조회 SP. password_hash를 포함해 전체 컬럼을 그대로 반환하며,
    --        API 응답에 어떤 필드를 노출할지(예: password_hash 제외, phone_number 복호화)는
    --        서비스 레이어가 결정한다 — SP는 원본 데이터만 돌려준다.
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
        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
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

-- ============================================================================================================ --
-- SP_USER_GET_BY_LOGIN_ID
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_GET_BY_LOGIN_ID`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_GET_BY_LOGIN_ID` (
    IN i_login_id VARCHAR(100)  -- 로그인 ID
) COMMENT '로그인 처리 전용 - login_id로 user 조회, role_code(MIN, 미배정시 40)까지 함께 계산'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_GET_BY_LOGIN_ID
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인(POST /auth/login) 처리용 사용자 조회. password_hash를 포함해 반환하므로
    --        앱 레이어가 bcrypt로 비교한다(SP는 비밀번호 검증 로직을 모른다).
    --        role_code는 user_session에 저장하지 않고 이 시점에 user_role을 조인해 계산한다
    --        (09_AUTH_API.md 7장 — 로그인/재발급 시점마다 동일한 방식으로 매번 재계산).
    --        login_id 자체가 없으면 10001(로그인 실패) — 비밀번호 불일치(10002)와는 앱 레이어에서 구분.
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
        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `login_id` = i_login_id) THEN
            SELECT 10001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            u.`user_id`, u.`company_id`, u.`requested_project_id`, u.`login_id`,
            u.`password_hash`, u.`user_name`, u.`email`, u.`phone_number`,
            u.`department`, u.`position`, u.`status`,
            COALESCE(MIN(ur.`role_code`), 40) AS role_code,
            u.`last_login_at`, u.`created_at`, u.`updated_at`
        FROM `user` u
        LEFT JOIN `user_role` ur ON u.`user_id` = ur.`user_id` AND ur.`status` = 1
        WHERE u.`login_id` = i_login_id
        GROUP BY
            u.`user_id`, u.`company_id`, u.`requested_project_id`, u.`login_id`,
            u.`password_hash`, u.`user_name`, u.`email`, u.`phone_number`,
            u.`department`, u.`position`, u.`status`,
            u.`last_login_at`, u.`created_at`, u.`updated_at`;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_LIST` (
    IN i_company_id BIGINT UNSIGNED,  -- 회사 ID 필터 (NULL이면 전체 - SUPER_ADMIN 전용, DEVELOPER는 서비스가 항상 자기 회사로 고정)
    IN i_status     TINYINT UNSIGNED, -- 상태 필터 (NULL이면 전체)
    IN i_limit      INT,              -- 페이지당 행 수
    IN i_offset     INT               -- 시작 오프셋
) COMMENT '사용자 목록 조회 - status ASC 정렬 (12_USER_API.md 1.1/1.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id/status 조건부 필터 + 페이지네이션. company.sql/project.sql과 동일하게
    --        COUNT(*) OVER()로 total_count를 각 행에 실어 RESULT+data 2-result-set 규약을 유지한다.
    --        다른 테이블은 status DESC가 기본이지만 user는 "가입승인대기(0)"가 가장 먼저 보여야
    --        하는 화면 요구사항이 있어 status ASC로 정렬한다(12_USER_API.md 1.1 Sorting, 다른
    --        도메인과 다른 정렬 방향이라는 점을 주석으로 명시).
    --        password_hash는 반환 컬럼에서 제외한다 — 목록/상세 어디서도 앱으로 내보낼 이유가 없다.
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

    SELECT 0 AS RESULT;
    SELECT
        `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
        `phone_number`, `department`, `position`, `status`, `last_login_at`,
        `created_at`, `updated_at`,
        COUNT(*) OVER() AS total_count
    FROM `user`
    WHERE (i_company_id IS NULL OR `company_id` = i_company_id)
      AND (i_status IS NULL OR `status` = i_status)
    ORDER BY `status` ASC, `user_name` ASC
    LIMIT i_limit OFFSET i_offset;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_PASSWORD_CHANGE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_PASSWORD_CHANGE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_PASSWORD_CHANGE` (
    IN i_user_id           BIGINT UNSIGNED,  -- 대상 사용자 ID
    IN i_new_password_hash VARCHAR(255)       -- 새 비밀번호 bcrypt 해시(앱 레이어에서 해시 완료)
) COMMENT '비밀번호 변경 + 전체 활성 세션 강제 로그아웃 (09_AUTH_API.md 9장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_PASSWORD_CHANGE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 현재 비밀번호 검증(bcrypt.compare)은 앱 레이어에서 이미 끝난 상태로 호출된다.
    --        password_hash 갱신과 "모든 활성 세션 종료"(07_AUTH_SECURITY.md 1.3)를 하나의
    --        트랜잭션으로 처리해, 비밀번호는 바뀌었는데 기존 세션이 살아있는 상태가 생기지 않게 한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    START TRANSACTION;

        UPDATE `user`
        SET `password_hash` = i_new_password_hash
        WHERE `user_id` = i_user_id;

        UPDATE `user_session`
        SET `status` = 0
        WHERE `user_id` = i_user_id AND `status` = 1;

    COMMIT;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_PASSWORD_RESET
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_PASSWORD_RESET`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_PASSWORD_RESET` (
    IN i_user_id           BIGINT UNSIGNED,  -- 대상 사용자 ID
    IN i_new_password_hash VARCHAR(255)      -- 새 비밀번호 bcrypt 해시(앱 레이어에서 해시 완료)
) COMMENT '관리자 비밀번호 강제 초기화 + 전체 활성 세션 종료 (12_USER_API.md 1.7)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_PASSWORD_RESET
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : SP_USER_PASSWORD_CHANGE(09_AUTH_API.md 9장, 본인 비밀번호 변경)와 로직은 거의
    --        동일하지만, 이쪽은 대상 user_id가 URL 파라미터로 임의 지정되므로(호출자 본인이
    --        아님) 존재 확인(31003)이 먼저 필요하다는 점이 다르다 - 그래서 SP를 공유하지 않고
    --        별도로 둔다. 현재 비밀번호 검증 없이 즉시 변경하며(12_USER_API.md 1.7 Description),
    --        password_hash 갱신과 "모든 활성 세션 종료"를 하나의 트랜잭션으로 묶는다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        START TRANSACTION;

            UPDATE `user`
            SET `password_hash` = i_new_password_hash
            WHERE `user_id` = i_user_id;

            UPDATE `user_session`
            SET `status` = 0
            WHERE `user_id` = i_user_id AND `status` = 1;

        COMMIT;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_REJECT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_REJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_REJECT` (
    IN i_user_id BIGINT UNSIGNED  -- 반려할 사용자 ID
) COMMENT '가입반려 - status 0(대기) -> 2(반려) 조건부 UPDATE (12_USER_API.md 1.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_REJECT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : SP_USER_APPROVE와 동일한 조건부 UPDATE + 실패 사유 진단 패턴(31003 vs 30004).
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
        UPDATE `user`
        SET `status` = 2
        WHERE `user_id` = i_user_id AND `status` = 0;

        IF ROW_COUNT() = 0 THEN
            IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
                SELECT 31003 AS RESULT;
            ELSE
                SELECT 30004 AS RESULT;
            END IF;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_CREATE` (
    IN i_user_id    BIGINT UNSIGNED,  -- 배정할 사용자 ID
    IN i_project_id BIGINT UNSIGNED,  -- 배정할 프로젝트 ID
    IN i_role_code  TINYINT UNSIGNED  -- 권한 코드 (20/30/40 - 10은 앱 레이어 DTO 검증에서 이미 차단)
) COMMENT 'user_role 배정 생성 - 회사 일치 검증 + 중복 배정 차단 (12_USER_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user 존재(31003) -> project 존재(31002) -> user.company_id와 project.company_id
    --        일치 여부(다른 회사 소속 프로젝트에는 등록 불가, 12_USER_API.md 3.1 Validation) ->
    --        (user_id, project_id) 중복 배정(32001) 순으로 검증한다. 회사 불일치는 인가 실패가
    --        아니라 "이 project_id 값 자체가 이 요청에서는 허용되지 않는다"는 입력값 검증으로
    --        보아 30003(허용되지 않는 값)을 쓴다 - PERMISSION_DENIED(20001)는 호출자 본인의
    --        권한 부족에, 30003은 요청 바디 조합 자체의 유효성 문제에 쓴다는 구분을 유지한다.
    --        복합 PK(user_id, project_id) 유니크 위반(경쟁 상태 백스톱) - mysql_errno 1062.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

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
        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM `project` WHERE `project_id` = i_project_id) THEN
            SELECT 31002 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM `user` u
            JOIN `project` p ON p.`company_id` = u.`company_id`
            WHERE u.`user_id` = i_user_id AND p.`project_id` = i_project_id
        ) THEN
            SELECT 30003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF EXISTS (
            SELECT 1 FROM `user_role`
            WHERE `user_id` = i_user_id AND `project_id` = i_project_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        INSERT INTO `user_role` (`user_id`, `project_id`, `role_code`)
        VALUES (i_user_id, i_project_id, i_role_code);

        SELECT 0 AS RESULT;
        SELECT `user_id`, `project_id`, `role_code`, `status`, `created_at`, `updated_at`
        FROM `user_role`
        WHERE `user_id` = i_user_id AND `project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_GET_BY_PROJECT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_GET_BY_PROJECT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_GET_BY_PROJECT` (
    IN i_user_id    BIGINT UNSIGNED,  -- 조회할 사용자 ID
    IN i_project_id BIGINT UNSIGNED   -- 조회할 프로젝트 ID
) COMMENT '특정 프로젝트에 대한 사용자의 실제 role_code 조회 (11_PROJECT_API.md 3.1)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_GET_BY_PROJECT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 헤더에서 선택된 project_id에 대한 호출자의 실제 role_code를 조회한다
    --        (11_PROJECT_API.md 3.1 — JWT의 role_code는 여러 프로젝트 중 최고 권한 하나뿐이라
    --        특정 project_id 기준 실제 권한은 이 SP로 별도 조회해야 함). 활성 배정(status=1)이
    --        없는 것은 오류가 아니라 정상적인 "미배정" 상태라 RESULT는 항상 0이고, 데이터가
    --        없으면 앱 레이어(UserRoleService)가 role_code:null로 매핑한다. SUPER_ADMIN은
    --        이 SP를 호출하지 않고 앱 레이어가 즉시 role_code:10을 반환한다(배정 여부 무관).
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

    SELECT 0 AS RESULT;
    SELECT `role_code`
    FROM `user_role`
    WHERE `user_id` = i_user_id AND `project_id` = i_project_id AND `status` = 1;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_LIST
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_LIST`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_LIST` (
    IN i_user_id    BIGINT UNSIGNED,  -- 사용자 ID 필터 (NULL이면 전체)
    IN i_project_id BIGINT UNSIGNED,  -- 프로젝트 ID 필터 (NULL이면 전체)
    IN i_role_code  TINYINT UNSIGNED, -- 권한 코드 필터 (NULL이면 전체)
    IN i_status     TINYINT UNSIGNED, -- 상태 필터 (NULL이면 전체)
    IN i_limit      INT,              -- 페이지당 행 수
    IN i_offset     INT               -- 시작 오프셋
) COMMENT 'user_role 목록 조회 (12_USER_API.md 3.2)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_LIST
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user_id/project_id/role_code/status 조건부 필터 + 페이지네이션. 다른 목록 SP와
    --        동일하게 COUNT(*) OVER()로 total_count를 각 행에 실어 반환한다. 정렬은
    --        12_USER_API.md 3.2 Sorting 그대로(status DESC, role_code ASC, user_id ASC).
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

    SELECT 0 AS RESULT;
    SELECT
        `user_id`, `project_id`, `role_code`, `status`, `created_at`, `updated_at`,
        COUNT(*) OVER() AS total_count
    FROM `user_role`
    WHERE (i_user_id IS NULL OR `user_id` = i_user_id)
      AND (i_project_id IS NULL OR `project_id` = i_project_id)
      AND (i_role_code IS NULL OR `role_code` = i_role_code)
      AND (i_status IS NULL OR `status` = i_status)
    ORDER BY `status` DESC, `role_code` ASC, `user_id` ASC
    LIMIT i_limit OFFSET i_offset;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_ROLE_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_ROLE_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_ROLE_UPDATE` (
    IN i_user_id    BIGINT UNSIGNED,  -- 복합 PK - 사용자 ID
    IN i_project_id BIGINT UNSIGNED,  -- 복합 PK - 프로젝트 ID
    IN i_role_code  TINYINT UNSIGNED, -- 새 권한 코드 (NULL이면 미변경, 10은 불가)
    IN i_status     TINYINT UNSIGNED  -- 새 상태 (NULL이면 미변경)
) COMMENT 'user_role 수정 - 조건부 UPDATE, role_code=10 전환 차단 (12_USER_API.md 3.3)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_ROLE_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : user_id/project_id는 복합 PK라 이 SP에서 변경 대상이 아니다(Non-Updatable Fields,
    --        12_USER_API.md 3.3). role_code=10(SUPER_ADMIN)으로의 변경은 명시적으로 30003을
    --        반환한다(3.3 Business Rules) - DTO 레이어에서 20/30/40으로 막지 않고 여기서 막는
    --        이유는 문서가 이 케이스를 SP/서비스 레벨의 명시적 오류 코드로 지정했기 때문이다.
    --        물리 삭제 없음 원칙에 따라 권한 중지는 status=0 조건부 UPDATE로만 처리한다.
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
        IF i_role_code = 10 THEN
            SELECT 30003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM `user_role` WHERE `user_id` = i_user_id AND `project_id` = i_project_id
        ) THEN
            SELECT 31007 AS RESULT;
            LEAVE proc_block;
        END IF;

        UPDATE `user_role`
        SET
            `role_code` = COALESCE(i_role_code, `role_code`),
            `status`    = COALESCE(i_status, `status`)
        WHERE `user_id` = i_user_id AND `project_id` = i_project_id;

        SELECT 0 AS RESULT;
        SELECT `user_id`, `project_id`, `role_code`, `status`, `created_at`, `updated_at`
        FROM `user_role`
        WHERE `user_id` = i_user_id AND `project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_CREATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_CREATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_CREATE` (
    IN i_user_id             BIGINT UNSIGNED,  -- 로그인한 사용자 ID
    IN i_access_token_jti    VARCHAR(100),      -- 발급한 Access Token의 JTI
    IN i_refresh_token_hash  VARCHAR(255),      -- Refresh Token(UUID v4) SHA-256 해시값
    IN i_expired_at          DATETIME          -- 세션 만료일시(JWT_REFRESH_EXPIRES_IN만큼 더한 절대시각)
) COMMENT '로그인 세션 생성 - last_login_at 갱신 + user_session INSERT (09_AUTH_API.md 5장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_CREATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 로그인 성공 시 user.last_login_at 갱신과 user_session INSERT를 하나의 트랜잭션으로 처리해
    --        원자성을 보장한다. role_code는 이미 SP_USER_GET_BY_LOGIN_ID에서 계산했으므로 여기서
    --        다시 계산하지 않는다(순수 세션 기록 전용).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_now         DATETIME     DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    SET v_now = NOW();

    START TRANSACTION;

        UPDATE `user`
        SET `last_login_at` = v_now
        WHERE `user_id` = i_user_id;

        INSERT INTO `user_session` (
            `user_id`, `access_token_jti`, `refresh_token_hash`, `expired_at`, `last_access_at`, `status`
        ) VALUES (
            i_user_id, i_access_token_jti, i_refresh_token_hash, i_expired_at, v_now, 1
        );

    COMMIT;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_GET_BY_REFRESH_HASH
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_GET_BY_REFRESH_HASH`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_GET_BY_REFRESH_HASH` (
    IN i_refresh_token_hash VARCHAR(255)  -- Refresh Token SHA-256 해시값
) COMMENT 'Refresh Token 해시로 활성 세션 조회, role_code 재계산 (09_AUTH_API.md 7장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_GET_BY_REFRESH_HASH
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : POST /auth/refresh 처리용 세션 조회. status=1이고 만료되지 않은 세션만 대상으로 하며,
    --        세션이 없거나 만료된 경우를 구분하지 않고 10008(Refresh Token 만료)로 통일한다.
    --        role_code는 SP_USER_GET_BY_LOGIN_ID와 동일하게 이 시점에 다시 계산한다(저장값을
    --        그대로 반환하지 않음 — 09_AUTH_API.md 7장 참고).
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
        IF NOT EXISTS (
            SELECT 1 FROM `user_session`
            WHERE `refresh_token_hash` = i_refresh_token_hash AND `status` = 1 AND `expired_at` > NOW()
        ) THEN
            SELECT 10008 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            s.`session_id`, s.`user_id`, u.`status` AS user_status, u.`company_id`,
            COALESCE(MIN(ur.`role_code`), 40) AS role_code
        FROM `user_session` s
        JOIN `user` u ON s.`user_id` = u.`user_id`
        LEFT JOIN `user_role` ur ON u.`user_id` = ur.`user_id` AND ur.`status` = 1
        WHERE s.`refresh_token_hash` = i_refresh_token_hash AND s.`status` = 1 AND s.`expired_at` > NOW()
        GROUP BY s.`session_id`, s.`user_id`, u.`status`, u.`company_id`;
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_LOGOUT
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_LOGOUT`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_LOGOUT` (
    IN i_access_token_jti VARCHAR(100)  -- 로그아웃할 현재 Access Token의 JTI
) COMMENT '현재 세션 로그아웃 - status=0 (09_AUTH_API.md 6장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_LOGOUT
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : JwtAuthGuard가 이미 유효성을 확인한 access_token_jti 기준으로 현재 세션만 종료한다.
    --        조건부 UPDATE(status=1인 행만 대상)라 이미 로그아웃된 세션에 다시 호출해도 안전하다
    --        (영향받은 행이 0건이어도 에러가 아니라 정상 종료 취급 — 멱등하게 동작).
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

    UPDATE `user_session`
    SET `status` = 0
    WHERE `access_token_jti` = i_access_token_jti AND `status` = 1;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_UPDATE_JTI
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_UPDATE_JTI`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_UPDATE_JTI` (
    IN i_session_id       BIGINT UNSIGNED,  -- 세션 ID
    IN i_access_token_jti VARCHAR(100)       -- 새로 발급한 Access Token JTI
) COMMENT 'Access Token 재발급 시 세션의 JTI/last_access_at 갱신 (09_AUTH_API.md 7장)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_UPDATE_JTI
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : POST /auth/refresh 처리 후 세션의 access_token_jti를 새 값으로 갱신한다.
    --        refresh_token은 재발급하지 않으므로(최초 로그인 시 1회만 저장) 여기서 건드리지 않는다.
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

    UPDATE `user_session`
    SET `access_token_jti` = i_access_token_jti,
        `last_access_at` = NOW()
    WHERE `session_id` = i_session_id;

    SELECT 0 AS RESULT;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SESSION_VALIDATE_BY_JTI
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SESSION_VALIDATE_BY_JTI`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SESSION_VALIDATE_BY_JTI` (
    IN i_access_token_jti VARCHAR(100)  -- 검증할 Access Token의 JTI
) COMMENT 'JwtAuthGuard 전용 - 세션/사용자 상태 검증 (07_AUTH_SECURITY.md 1.5 3~4번)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_SESSION_VALIDATE_BY_JTI
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : 보호된 API 요청마다 JwtAuthGuard가 호출하는 세션/사용자 상태 검증
    --        (07_AUTH_SECURITY.md 1.5 "3. Session 확인 / 4. User 상태 확인").
    --        role_code는 여기서 다시 조회하지 않는다 — Access Token(JWT) 자체가 이미 서명으로
    --        보증된 role_code를 담고 있어, 매 요청마다 user_role을 다시 조인하는 건 불필요한 비용이다
    --        (role_code는 로그인/재발급 시점에만 재계산, 09_AUTH_API.md 7장 참고).
    --        세션이 없거나 로그아웃(status!=1)되었거나 만료(expired_at<=NOW())된 경우
    --        10009(유효하지 않은 Session)를 반환한다 — expired_at 체크가 없으면 세션 만료 이후에도
    --        그 직전에 발급된 Access Token이 자기 수명(15분)이 남아있는 동안 계속 통과해버리는
    --        구멍이 생긴다(2026-07-19 리뷰에서 발견, SP_USER_SESSION_GET_BY_REFRESH_HASH와
    --        동일하게 맞춤).
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
        IF NOT EXISTS (
            SELECT 1 FROM `user_session`
            WHERE `access_token_jti` = i_access_token_jti AND `status` = 1 AND `expired_at` > NOW()
        ) THEN
            SELECT 10009 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT u.`user_id`, u.`company_id`, u.`status` AS user_status
        FROM `user_session` s
        JOIN `user` u ON s.`user_id` = u.`user_id`
        WHERE s.`access_token_jti` = i_access_token_jti AND s.`status` = 1 AND s.`expired_at` > NOW();
    END proc_block;
END$$

DELIMITER ;

-- ============================================================================================================ --
-- SP_USER_SIGNUP
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_SIGNUP`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_SIGNUP` (
    IN i_company_id            BIGINT UNSIGNED,  -- 가입 신청 회사 ID
    IN i_requested_project_id  BIGINT UNSIGNED,  -- 가입 신청 프로젝트 ID (영구 보관, 이후 변경 불가)
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
    -- 내용 : 회원가입 처리. company_id/requested_project_id 존재 및 소속 관계를 검증하고,
    --        login_id/email 중복을 확인한 뒤 status=0(가입승인대기)으로 user를 생성한다.
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

        IF NOT EXISTS (
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

-- ============================================================================================================ --
-- SP_USER_UPDATE
-- ============================================================================================================ --
DROP PROCEDURE IF EXISTS `SP_USER_UPDATE`;
DELIMITER $$
CREATE PROCEDURE `SP_USER_UPDATE` (
    IN i_user_id          BIGINT UNSIGNED,  -- 수정할 사용자 ID
    IN i_user_name        VARCHAR(100),     -- 새 사용자명 (NULL이면 미변경)
    IN i_email            VARCHAR(200),     -- 새 이메일 (NULL이면 미변경)
    IN i_phone_number_enc VARCHAR(255),     -- 새 휴대폰번호 AES-256-CBC 암호화값 (NULL이면 미변경)
    IN i_department       VARCHAR(100),     -- 새 부서 (NULL이면 미변경)
    IN i_position         VARCHAR(100),     -- 새 직급 (NULL이면 미변경)
    IN i_status           TINYINT UNSIGNED  -- 새 상태 (NULL이면 미변경)
) COMMENT '사용자 정보 수정 - 조건부 UPDATE + status=3 전환 시 전체 세션 종료 (12_USER_API.md 1.6)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_USER_UPDATE
    -- 작성 : 2026.07.19 trisakion
    -- 내용 : company_id/requested_project_id/login_id는 이 SP의 파라미터에 아예 없다 - 수정 불가
    --        필드라 애초에 받지 않는다(12_USER_API.md 1.6 Non-Updatable Fields). 존재 확인(31003)
    --        -> email 변경 시 중복 확인(자기 자신 제외, 32001) -> COALESCE 기반 조건부 UPDATE
    --        (02_DEV_CONVENTIONS.md 4장). email 유니크 제약 위반(1062) 백스톱도 CREATE/UPDATE류
    --        SP와 동일한 이유로 둔다.
    --        i_status=3(사용중지)으로 전환하는 경우에만 해당 사용자의 활성 세션을 전부 종료한다
    --        (12_USER_API.md 1.6 Business Rules, 07_AUTH_SECURITY.md 1.3) - 이미 3이었거나 다른
    --        값으로 바뀌는 경우는 세션에 영향을 주지 않는다. UPDATE 규약(3.4)은 status 값 전이
    --        자체를 검증하지 않는다고 명시하므로(화면 버튼 기준일 뿐) 여기서도 임의의 status 값
    --        전달을 그대로 허용한다.
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';

    -- email 유니크 제약 위반(경쟁 상태로 사전 체크를 통과한 경우의 백스톱) — mysql_errno 1062
    DECLARE EXIT HANDLER FOR 1062
    BEGIN
        SELECT 32001 AS RESULT;
    END;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            sql_state = RETURNED_SQLSTATE, error_no = MYSQL_ERRNO, error_message = MESSAGE_TEXT;
        ROLLBACK;
        SELECT 50001 AS RESULT, sql_state AS SQL_STATE, error_no AS ERROR_NO, error_message AS ERROR_MESSAGE;
    END;

    proc_block: BEGIN
        IF NOT EXISTS (SELECT 1 FROM `user` WHERE `user_id` = i_user_id) THEN
            SELECT 31003 AS RESULT;
            LEAVE proc_block;
        END IF;

        IF i_email IS NOT NULL AND EXISTS (
            SELECT 1 FROM `user` WHERE `email` = i_email AND `user_id` <> i_user_id
        ) THEN
            SELECT 32001 AS RESULT;
            LEAVE proc_block;
        END IF;

        START TRANSACTION;

            UPDATE `user`
            SET
                `user_name`    = COALESCE(i_user_name, `user_name`),
                `email`        = COALESCE(i_email, `email`),
                `phone_number` = COALESCE(i_phone_number_enc, `phone_number`),
                `department`   = COALESCE(i_department, `department`),
                `position`     = COALESCE(i_position, `position`),
                `status`       = COALESCE(i_status, `status`)
            WHERE `user_id` = i_user_id;

            IF i_status = 3 THEN
                UPDATE `user_session`
                SET `status` = 0
                WHERE `user_id` = i_user_id AND `status` = 1;
            END IF;

        COMMIT;

        SELECT 0 AS RESULT;
        SELECT
            `user_id`, `company_id`, `requested_project_id`, `login_id`, `user_name`, `email`,
            `phone_number`, `department`, `position`, `status`, `last_login_at`,
            `created_at`, `updated_at`
        FROM `user`
        WHERE `user_id` = i_user_id;
    END proc_block;
END$$

DELIMITER ;
