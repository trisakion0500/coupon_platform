DROP PROCEDURE IF EXISTS `SP_PROJECT_API_SECRET_ROTATE`;
DELIMITER $$
CREATE PROCEDURE `SP_PROJECT_API_SECRET_ROTATE` (
    IN i_project_id      BIGINT UNSIGNED,  -- 재발급 대상 프로젝트 ID
    IN i_edit_count      INT UNSIGNED,     -- 낙관적 동시성 제어 토큰(2.3 조회 시 받은 edit_count 그대로)
    IN i_user_id         BIGINT UNSIGNED,  -- 요청자 user_id (JWT 페이로드 값 그대로 신뢰)
    IN i_new_api_secret_enc VARCHAR(255)   -- 새 API Secret AES-256-CBC 암호화값 (앱 레이어에서 암호화 완료)
) COMMENT 'API Secret 재발급 - Grace Period 방식 + edit_count 낙관적 락 (11_PROJECT_API.md 2.5)'
BEGIN
    -- ------------------------------------------------------------------------------------------------------------ --
    -- 명칭 : SP_PROJECT_API_SECRET_ROTATE
    -- 작성 : 2026.07.19 trisakion
    -- 수정1: 2026.07.21 trisakion — 리뷰에서 이 UPDATE에 버전 체크가 전혀 없다는 걸 발견함. 더블
    --        클릭이나 타임아웃 후 재시도로 거의 동시에 두 번 재발급되면, api_secret_prev 슬롯이
    --        하나뿐이라 첫 번째 재발급이 만든 grace-period 값을 두 번째가 곧바로 덮어써 원래
    --        시크릿(S0)이 흔적도 없이 사라지는 문제가 있었다(아직 S0로 서명 중인 게임서버가
    --        있었다면 grace period가 예고 없이 조기 종료됨). "재발급 자체를 언제까지 막을지"를
    --        시간(grace period 경과)으로 판단하는 방식도 검토했으나, 그건 "지금 이 행위를 해도
    --        되는 시점인가"라는 별개의 정책 질문이고, 정작 이 버그가 실제로 묻는 질문은
    --        "호출자가 최신 상태를 보고 요청한 게 맞는가"(concurrency)라 `coupon_campaign.edit_count`
    --        와 동일한 낙관적 락으로 해결한다(project.sql 헤더 주석 참고) — 더블클릭/재시도는 항상
    --        같은(오래된) edit_count를 들고 오므로 두 번째 요청이 정확히 충돌(30005)로 걸러진다.
    --        내용 : 존재 확인(31002) 후, FN_IS_SUPER_ADMIN(i_user_id)이 아니면 FN_CHECK_PROJECT_ACCESS로
    --        해당 project_id에 실제 활성 user_role 배정이 있는지 재검증한다(11_PROJECT_API.md 2.5
    --        Business Rules — JWT의 role_code는 여러 프로젝트 중 최고 권한 하나뿐이라 이 project_id
    --        기준으로는 다시 확인해야 함). 원래는 앱이 전달한 i_role_code로 SUPER_ADMIN 우회를
    --        판단했으나, 02_DEV_CONVENTIONS.md 3.2 정책(SP는 호출자의 role_code 값을 앱으로부터
    --        전달받아 신뢰하지 않는다) 전면 적용 때 이 SP만 누락돼 있던 것을 2026-07-19 감사에서
    --        발견해 FN_IS_SUPER_ADMIN 재확인으로 교체했다(API Secret 재발급은 보안 민감 기능이라
    --        다른 SP보다 오히려 더 엄격해야 함). 통과하면 기존 api_secret을 api_secret_prev로 옮기고
    --        신규 값을 api_secret에 저장, secret_rotated_at을 갱신한다(07_AUTH_SECURITY.md 2.6
    --        Grace Period 방식). api_key는 변경하지 않는다. 반환 컬럼에 api_secret(암호문)은
    --        포함하지 않는다 — 평문은 앱 레이어가 자신이 생성한 값을 응답에 직접 얹는다.
    --        2026-07-20: 감사로그(log_audit) 적재를 위해 UPDATE 직전 현재 행을 v_before_json에
    --        캡처하고, 결과 SELECT에 company_id/project_name(스코핑/표시명용)과
    --        before_json/after_json/requester_name을 추가했다. api_secret/api_secret_prev는
    --        '***'로 마스킹한다(13_LOG_AUDIT_API.md 2.4).
    -- ------------------------------------------------------------------------------------------------------------ --
    DECLARE sql_state     CHAR(5)      DEFAULT '00000';
    DECLARE error_no      INT          DEFAULT 0;
    DECLARE error_message VARCHAR(255) DEFAULT '';
    DECLARE v_before_json JSON         DEFAULT NULL;
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

        IF NOT FN_IS_SUPER_ADMIN(i_user_id) AND NOT FN_CHECK_PROJECT_ACCESS(i_user_id, i_project_id) THEN
            SELECT 20001 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT JSON_OBJECT(             -- before_json: UPDATE 직전 스냅샷(api_secret류 마스킹)
            'project_id', `project_id`, 'company_id', `company_id`,
            'project_code', `project_code`, 'project_name', `project_name`,
            'description', `description`, 'api_key', `api_key`,
            'api_secret', '***',
            'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
            'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
            'created_at', `created_at`, 'updated_at', `updated_at`
        ) INTO v_before_json
        FROM `project` WHERE `project_id` = i_project_id;

        UPDATE `project`
        SET
            `api_secret_prev`   = `api_secret`,
            `api_secret`        = i_new_api_secret_enc,
            `secret_rotated_at` = NOW(),
            `edit_count`        = `edit_count` + 1
        WHERE `project_id` = i_project_id
          AND `edit_count` = i_edit_count;

        IF ROW_COUNT() = 0 THEN
            SELECT 30005 AS RESULT;
            LEAVE proc_block;
        END IF;

        SELECT 0 AS RESULT;
        SELECT
            `project_id`, `company_id`, `project_name`, `secret_rotated_at`, `edit_count`,
            v_before_json AS before_json,
            JSON_OBJECT(
                'project_id', `project_id`, 'company_id', `company_id`,
                'project_code', `project_code`, 'project_name', `project_name`,
                'description', `description`, 'api_key', `api_key`,
                'api_secret', '***',
                'api_secret_prev', IF(`api_secret_prev` IS NULL, NULL, '***'),
                'secret_rotated_at', `secret_rotated_at`, 'status', `status`,
                'created_at', `created_at`, 'updated_at', `updated_at`
            ) AS after_json,
            (SELECT `user_name` FROM `user` WHERE `user_id` = i_user_id) AS requester_name
        FROM `project`
        WHERE `project_id` = i_project_id;
    END proc_block;
END$$

DELIMITER ;
