-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : company
-- 작성 : 2026.07.11 trisakion
-- 내용 : 플랫폼 이용 회사 정보
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `company`;
CREATE TABLE `company` (
  `company_id`				BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '회사 ID',
  `company_code`			VARCHAR(20)				NOT NULL															COMMENT '회사 코드',
  `company_name`			VARCHAR(100)			NOT NULL															COMMENT '회사명',
  `description`				VARCHAR(1000)						DEFAULT NULL											COMMENT '설명',
  `status`					TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '상태 (1:사용, 0:중지)',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '생성일시',
  `updated_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP	COMMENT '수정일시',
  PRIMARY KEY (`company_id`),
  UNIQUE KEY `uk_company_code` (`company_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='플랫폼 이용 회사';
INSERT INTO `company` (`company_id`, `company_code`, `company_name`, `description`, `status`, `created_at`, `updated_at`)
VALUES
(1, 'ADMIN', 'Administrator Company', NULL, 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00'),
(2, 'DEV',   'Developer Company',     NULL, 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00');
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : project
-- 작성 : 2026.07.11 trisakion
-- 내용 : 서비스 프로젝트 정보
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `project`;
CREATE TABLE `project` (
  `project_id`				BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '프로젝트 ID',
  `company_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT '회사 ID',
  `project_code`			VARCHAR(20)				NOT NULL															COMMENT '프로젝트 코드',
  `project_name`			VARCHAR(100)			NOT NULL															COMMENT '프로젝트명',
  `description`				VARCHAR(1000)						DEFAULT NULL											COMMENT 'Project 설명',
  `api_key`					VARCHAR(64)				NOT NULL															COMMENT '서버간 호출용 API Key (게임서버 -> 쿠폰서버)',
  `api_secret_hash`			VARCHAR(255)			NOT NULL															COMMENT '현재 사용중인 API Secret 해시값 (평문 저장 금지)',
  `api_secret_hash_prev`	VARCHAR(255)						DEFAULT NULL											COMMENT '직전 API Secret 해시값 (재발급 후 유예기간 동안만 유지, 유예기간 경과 시 배치로 NULL 처리)',
  `secret_rotated_at`		DATETIME							DEFAULT NULL											COMMENT '마지막 Secret 재발급 시각 (NULL이면 최초 발급 후 미변경)',
  `status`					TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '상태 (1:사용, 0:중지)',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '생성일시',
  `updated_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP	COMMENT '수정일시',
  PRIMARY KEY (`project_id`),
  UNIQUE KEY `uk_company_project_code` (`company_id`,`project_code`),
  UNIQUE KEY `uk_project_api_key` (`api_key`),
  KEY `ix_project_company_id` (`company_id`),
  KEY `ix_status` (`status`),
  CONSTRAINT `fk_project_company_id` FOREIGN KEY (`company_id`) REFERENCES `company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='서비스 프로젝트 정보';
INSERT INTO `project` (`project_id`, `company_id`, `project_code`, `project_name`, `description`, `api_key`, `api_secret_hash`, `status`, `created_at`, `updated_at`)
VALUES
(1, 1, 'ADMIN_PROJECT', 'Administrator Company Default Project', NULL, 'dev-admin-project-api-key', 'f9c87e280f0434e663a6bf099cb55704913dda28392c593724a2f1773ad8ff3d', 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00'),
(2, 2, 'DEV_PROJECT',   'Developer Company Default Project',     NULL, 'dev-dev-project-api-key',   '24b2574cb5aef9d55637b3d01c15b9f402e63fcef294ef06ceb9a4511bc01dc7', 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00');
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : user
-- 작성 : 2026.07.15 trisakion
-- 내용 : 플랫폼 사용자 계정 (회사 소속 사용자)
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `user_id`					BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '사용자 ID',
  `company_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT '회사 ID',
  `requested_project_id`	BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '가입 신청 프로젝트 ID(회원가입시의 값 영구 유지)',
  `login_id`				VARCHAR(100)			NOT NULL															COMMENT '로그인 ID',
  `password_hash`			VARCHAR(255)			NOT NULL															COMMENT '비밀번호 해시',
  `user_name`				VARCHAR(100)			NOT NULL															COMMENT '사용자명',
  `email`					VARCHAR(200)			NOT NULL															COMMENT '이메일 (알림/연락용)',
  `phone_number`			VARCHAR(255)			NOT NULL															COMMENT '휴대폰 번호(AES-256-CBC 암호화(Base64))',
  `department`				VARCHAR(100)																				COMMENT '부서',
  `position`				VARCHAR(100)																				COMMENT '직급',
  `status`					TINYINT		UNSIGNED	NOT NULL	DEFAULT 0												COMMENT '상태 (0:가입승인대기, 1:가입승인, 2: 가입반려, 3: 사용중지)',
  `last_login_at`			DATETIME							DEFAULT NULL											COMMENT '마지막 로그인 일시',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '생성일시',
  `updated_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP	COMMENT '수정일시',
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uk_login_id` (`login_id`),
  UNIQUE KEY `uk_email` (`email`),
  KEY `ix_user_company_id` (`company_id`),
  KEY `ix_requested_project_id` (`requested_project_id`),
  CONSTRAINT `fk_user_company_id` FOREIGN KEY (`company_id`) REFERENCES `company` (`company_id`),
  CONSTRAINT `fk_user_requested_project` FOREIGN KEY (`requested_project_id`) REFERENCES `project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='플랫폼 사용자 계정';
INSERT INTO `user` (`user_id`, `company_id`, `requested_project_id`, `login_id`, `password_hash`, `user_name`, `email`, `phone_number`, `department`, `position`, `status`, `created_at`, `updated_at`)
VALUES
(1, 1, 1, 'sa',  '$2b$12$otGL1k53beXFC4vChLwlVeoMkXovoE4rfuPkEnygv.aiQ8LjRcOuS', 'Super Admin', 'sa@example.com',  'kcdK4Qm09olJSKrCV58sIW4JscfLIAjl09AHrwrR72Y=', NULL, NULL, 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00'),
(2, 2, 2, 'dev', '$2b$12$1PS6AzxZYchKl7RJHMPZ/uaKT7nUWPDU8WwspbxOX6gOmd68nwpY2', 'Developer',   'dev@example.com', 'X6c9BJWsQGv9X5EyVHY2hq9fe6KSnDp3mzt8JU0LuJM=', NULL, NULL, 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00'),
(3, 2, 2, 'mgr', '$2b$12$1ThA8g9/VAhfTW6ZrFJb..B1j3DEIp/T8zLYQsn1Dlf/HX/6KblFK', 'Manager',     'mgr@example.com', 'R2ncGLJtuKH3YRn72s5vZCoaZaUCcIv+zftwoKPJEUs=', NULL, NULL, 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00'),
(4, 2, 2, 'op',  '$2b$12$1ThA8g9/VAhfTW6ZrFJb..B1j3DEIp/T8zLYQsn1Dlf/HX/6KblFK', 'Operator',    'op@example.com',  'Zx9pLQ2mNcRt7VbY4KdWjHfSaEoIuGxPzTnMqCvXsBk1L8=', NULL, NULL, 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00');
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : user_role
-- 작성 : 2026.07.15 trisakion
-- 내용 : 사용자 - 프로젝트 권한 매핑 (10단위 role 레벨 코드)
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `user_role`;
CREATE TABLE `user_role` (
  `user_id`					BIGINT		UNSIGNED	NOT NULL															COMMENT '사용자 ID',
  `project_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT '프로젝트 ID',
  `role_code`				TINYINT		UNSIGNED	NOT NULL															COMMENT '권한 코드 (10:SUPER_ADMIN, 20:DEVELOPER, 30:MANAGER, 40:OPERATOR. SUPER_ADMIN은 어떤 프로젝트에 연결되어도 무관함)',
  `status`					TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '상태 (1:사용, 0:중지)',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '생성일시',
  `updated_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP	COMMENT '수정일시',
  PRIMARY KEY (`user_id`,`project_id`),
  KEY `ix_user_role_project_id` (`project_id`),
  CONSTRAINT `fk_user_role_project` FOREIGN KEY (`project_id`) REFERENCES `project` (`project_id`),
  CONSTRAINT `fk_user_role_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='사용자 프로젝트 권한 매핑 (10단위 role 레벨 코드)';
INSERT INTO `user_role` (`user_id`, `project_id`, `role_code`, `status`, `created_at`, `updated_at`)
VALUES
(1, 1, 10, 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00'),
(2, 2, 20, 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00'),
(3, 2, 30, 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00'),
(4, 2, 40, 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00');
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : user_session
-- 작성 : 2026.07.15 trisakion
-- 내용 : 사용자 인증 세션 관리
--        Access Token / Refresh Token 기반 인증 정보 저장
--        로그인 시 생성되며 로그아웃 또는 만료 시 상태 변경
--        사용자 상태(user.status)와 별도로 관리
--        향후 Redis 기반 세션 저장소로 확장 가능하도록 설계
--        [FK 미적용 의도] user_id 에 대한 FK 를 적용하지 않음
--                        세션 조회는 access_token_jti 기준으로 수행하므로
--                        MySQL → Redis 저장소 전환 시 인증 로직 수정 없이 확장 가능하도록 설계
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `user_session`;
CREATE TABLE `user_session` (
  `session_id`				BIGINT		UNSIGNED    NOT NULL	AUTO_INCREMENT											COMMENT '세션 ID',
  `user_id`					BIGINT		UNSIGNED    NOT NULL															COMMENT '사용자 ID',
  `access_token_jti`		VARCHAR(100)			NOT NULL															COMMENT 'Access Token 식별자(JTI)',
  `refresh_token_hash`		VARCHAR(255)			NOT NULL															COMMENT 'Refresh Token 해시값',
  `expired_at`				DATETIME				NOT NULL															COMMENT '세션 만료일시',
  `last_access_at`			DATETIME							DEFAULT NULL											COMMENT '마지막 접근일시',
  `status`					TINYINT		UNSIGNED	NOT NULL DEFAULT 1													COMMENT '상태 (1:사용, 0:로그아웃, 2:만료)',
  `created_at`				DATETIME				NOT NULL DEFAULT CURRENT_TIMESTAMP									COMMENT '생성일시',
  `updated_at`				DATETIME				NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP		COMMENT '수정일시',
  PRIMARY KEY (`session_id`),
  UNIQUE KEY `uk_access_token_jti` (`access_token_jti`),
  KEY `ix_user_id` (`user_id`),
  KEY `ix_status` (`status`),
  KEY `ix_expired_at` (`expired_at`),
  KEY `ix_last_access_at` (`last_access_at`)
  -- CONSTRAINT `fk_user_session_user` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='사용자 인증 세션 관리 (Access Token / Refresh Token 기반, 로그인 이력 및 세션 상태 저장)';
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : coupon_campaign
-- 작성 : 2026.07.16 trisakion
-- 내용 : 쿠폰 캠페인 정책 정보
--        실제 코드 값은 code_type 무관하게 항상 coupon_code 테이블에만 저장(중복 저장 없음)
-- 코드 발급 방식
--  - 1:RANDOM    > 1회 사용 가능한 coupon_code 생성
--  - 2:FIXED     > n회 사용 가능한 coupon_code 생성
-- 쿠폰 코드 하이픈 포함 여부
--  * 코드 발급 방식
--   - 1:RANDOM    > 선택 가능
--   - 2:FIXED     > 선택 불가(사용자가 입력한 문구 그대로 사용함)
-- 목표 발급 수량(관리자가 정한 쿠폰 수량) / 실제 발급 수량(시스템이 실제 발급한 수량)
--  * 코드 발급 방식
--   - 1:RANDOM    > 목표 발급 수량만큼 랜덤한 쿠폰코드를 생성한 수량 갱신
--   - 2:FIXED     > 관리자가 정한 쿠폰코드로 단 하나의 쿠폰을 생성하고 목표 발급 수량으로 수정
-- 실제 사용 가능 수량(usable_qty)
--  선착순 오픈처럼 generated_qty(전체 발급분)보다 적게 열어두는 용도(예: 1000개 발급하고 500개만 우선 오픈).
--  reserve 성공 시 used_qty 가 같은 트랜잭션에서 원자적으로 +1 되므로(coupon_code_usage 참고),
--  가용 여부 판단은 used_qty(컬럼값) 대 usable_qty 단순 비교로 충분하다(실시간 COUNT 쿼리 불필요).
-- 동시성(오버셀 방지)
--  reserve 시 "UPDATE coupon_campaign SET used_qty=used_qty+1
--             WHERE used_qty<usable_qty AND status=2 AND NOW() BETWEEN campaign_start AND campaign_end"
--  조건부 갱신 하나로 수량/상태(활성)/기간을 동시에 원자적으로 체크한다.
--  status/기간 조건을 같은 UPDATE 에 포함시키면 관리자가 캠페인을 일시중지/종료시키는 시점과
--  겹치는 reserve 요청도 추가 비용 없이 함께 막힌다(별도 락 불필요).
-- 쿠폰 코드 생성 (RANDOM 전용, FIXED는 관리자 입력값 그대로 사용)
--  - nanoid.customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 12)().match(/.{1,4}/g)?.join('-') > XXXX-XXXX-XXXX
-- 승인 워크플로우 (approval_status, status와 별개 축)
--  status(대기/활성/일시중지/종료)는 캠페인의 라이프사이클, approval_status는 그 캠페인을
--  실제로 활성화해도 되는지에 대한 승인 여부다. 둘을 분리하지 않으면 "시작일 전이라 대기중인
--  승인된 캠페인"과 "승인 자체가 안 된 캠페인"을 같은 값(status=1)으로 표현하게 되어 구분이 안 된다.
--  - MANAGER 이상이 생성/컨트롤 → approval_status=1(승인불요)로 즉시 시작, 승인 절차 없음
--  - OPERATOR가 생성/컨트롤    → approval_status=2(승인대기)로 시작, 10/20/30이 승인/반려
--  - status를 2(활성)로 전환하는 SP는 approval_status IN (1,3)(승인불요/승인완료)일 때만 허용한다.
--    reserve 시점의 조건부 UPDATE(위 동시성 절)는 status=2만 체크하면 되고 approval_status를
--    매번 다시 검사할 필요는 없다 — 애초에 미승인 캠페인은 status=2에 도달할 수 없기 때문.
--  변경 이력(누가 언제 승인/반려했는지)은 log_coupon_campaign에 append-only로 별도 기록한다.
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `coupon_campaign`;
CREATE TABLE `coupon_campaign` (
  `coupon_campaign_id`		BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '캠페인 ID',
  `project_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT 'project.project_id 소속 게임 ID',
  `name`					VARCHAR(100)			NOT NULL															COMMENT '캠페인명',
  `campaign_start`			DATETIME				NOT NULL															COMMENT '사용 가능 시작일시',
  `campaign_end`			DATETIME				NOT NULL															COMMENT '사용 가능 종료일시',
  `code_type`				TINYINT		UNSIGNED	NOT NULL															COMMENT '코드 발급 방식 (1:RANDOM, 2:FIXED)',
  `use_hyphen`				TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '쿠폰 코드 하이픈 포함 여부 (1:포함, 0:미포함). RANDOM에만 적용, FIXED는 사용자입력값 그대로 사용',
  `requested_qty`			INT			UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '목표 발급 수량',
  `generated_qty`			INT			UNSIGNED	NOT NULL	DEFAULT 0												COMMENT '실제 발급 수량',
  `usable_qty`				INT			UNSIGNED	NOT NULL	DEFAULT 0												COMMENT '실제 사용 가능 수량(선착순 오픈 등으로 generated_qty보다 적을 수 있음)',
  `used_qty`				INT			UNSIGNED	NOT NULL	DEFAULT 0												COMMENT '실제 사용(소모) 수량(reserve 성공 시점 즉시 확정 기준, confirm 여부와 무관)',
  `use_limit_per_user`		INT			UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '동일 유저 재사용 허용 횟수',
  `status`					TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '상태 (1:대기, 2:활성, 3:일시중지, 4:종료)',
  `approval_status`			TINYINT		UNSIGNED	NOT NULL	DEFAULT 2												COMMENT '승인상태 (1:승인불요, 2:승인대기, 3:승인완료, 4:반려) — status와 별개 축, fail-safe 기본값은 승인대기',
  `approved_by`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '승인/반려 처리자 계정 ID (user.user_id)',
  `approved_at`				DATETIME							DEFAULT NULL											COMMENT '승인/반려 처리일시',
  `reject_reason`			VARCHAR(500)						DEFAULT NULL											COMMENT '반려 사유',
  `reward_data`				JSON					NOT NULL															COMMENT '보상 내용(아이템/재화 등 자유 스키마, 쿠폰서버는 해석하지 않고 그대로 pass-through)',
  `created_by`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '생성자 계정 ID (user.user_id)',
  `updated_by`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '수정자 계정 ID (user.user_id)',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '생성일시',
  `updated_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP	COMMENT '수정일시',
  PRIMARY KEY (`coupon_campaign_id`),
  KEY `ix_project_status` (`project_id`,`status`),
  KEY `ix_project_approval_status` (`project_id`,`approval_status`),
  KEY `ix_code_type` (`code_type`),
  CONSTRAINT `fk_coupon_campaign_project` FOREIGN KEY (`project_id`) REFERENCES `project` (`project_id`),
  CONSTRAINT `fk_coupon_campaign_created_by` FOREIGN KEY (`created_by`) REFERENCES `user` (`user_id`),
  CONSTRAINT `fk_coupon_campaign_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `user` (`user_id`),
  CONSTRAINT `fk_coupon_campaign_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 캠페인 정책 정보';
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : coupon_code
-- 작성 : 2026.07.16 trisakion
-- 내용 : 쿠폰 코드 실물 정보 (RANDOM/FIXED 공통, coupon_campaign.code_type에 따라 status 의미가 다름)
--        RANDOM: 코드 1건 = 1회용. reserve 시 "UPDATE coupon_code SET status=사용완료 WHERE status=미사용"
--                조건부 갱신 한 번으로 검증+소모 확정까지 원자적으로 끝난다(별도 예약중 단계 없음,
--                이 조건부 갱신 자체가 동시 예약을 방지하는 락 역할도 겸한다).
--                코드 문자열은 nanoid 생성규칙을 그대로 사용한다.
--        FIXED : 코드 1건을 여러 사용자가 각자 사용. 이 코드 자체는 사용자별로 소진되지 않으므로
--                status는 "이 코드 자체가 활성 상태인지"만 나타낸다(0=관리자가 회수/중지, 1=사용중).
--                실제 사용자별 소모 이력과 사용 한도 체크는 coupon_code_usage 테이블에서 처리한다.
--                코드 문자열은 관리자가 입력한 값을 그대로 사용한다(use_hyphen과 동일한 원칙
--                — FIXED는 시스템이 값을 가공하지 않음).
--        confirmed_at/user_id 등 사용 이력은 여기 두지 않고 coupon_code_usage에서 관리한다
--        (RANDOM도 reserve 시 usage 행을 생성).
-- project_id (비정규화)
--  coupon_campaign_id 로도 project_id 를 조인해 알 수 있지만, code_value 의 유니크 범위를
--  프로젝트 단위로 좁히기 위해 비정규화해서 직접 둔다(uk_project_code_value 참고).
--  FIXED 코드는 관리자가 자유 문자열을 입력하므로, code_value 를 전체 프로젝트 통틀어 유니크로
--  두면 서로 다른 회사가 같은 문구(예: "SUMMER2024")를 쓰려 할 때 충돌한다 — 유니크 범위를
--  (project_id, code_value) 로 좁혀 프로젝트별로만 유일하면 되도록 한다.
--  reserve 조회도 이 덕분에 "WHERE project_id=? AND code_value=?" 로 자연스럽게 프로젝트
--  소속까지 함께 검증된다(다른 프로젝트 소속 코드를 잘못 조회하는 것을 방지).
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `coupon_code`;
CREATE TABLE `coupon_code` (
  `coupon_code_id`			BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '쿠폰 코드 ID',
  `coupon_campaign_id`		BIGINT		UNSIGNED	NOT NULL															COMMENT '소속 캠페인 ID (coupon_campaign.coupon_campaign_id)',
  `project_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT '소속 프로젝트 ID (project.project_id, coupon_campaign에서 비정규화 — code_value 유니크 범위/reserve 조회 스코핑용)',
  `code_value`				VARCHAR(50)				NOT NULL															COMMENT '쿠폰 코드 문자열 (RANDOM: 생성규칙 적용, FIXED: 관리자 입력값 그대로)',
  `status`					TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '상태 (0:중지, 1:미사용(RANDOM)/사용중(FIXED), 2:사용완료(RANDOM 전용))',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '생성일시',
  `updated_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP	COMMENT '수정일시',
  PRIMARY KEY (`coupon_code_id`),
  UNIQUE KEY `uk_project_code_value` (`project_id`,`code_value`),
  KEY `ix_campaign_status` (`coupon_campaign_id`,`status`),
  CONSTRAINT `fk_coupon_code_campaign` FOREIGN KEY (`coupon_campaign_id`) REFERENCES `coupon_campaign` (`coupon_campaign_id`),
  CONSTRAINT `fk_coupon_code_project` FOREIGN KEY (`project_id`) REFERENCES `project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 코드 실물 정보';
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : coupon_code_usage
-- 작성 : 2026.07.17 trisakion
-- 내용 : 쿠폰 코드 사용 기록 (RANDOM/FIXED 공통)
--        game_user_id 는 coupon_platform 의 관리콘솔 계정(`user`)과 무관한 별개 신원 체계.
--        실제 쿠폰을 쓰는 주체는 게임 플레이어이며 그 계정 정보는 게임서버 DB에만 존재하므로
--        FK 없이 게임서버가 S2S 호출 시 넘겨주는 식별자 원문을 문자열로 그대로 저장한다
--        (게임서버마다 포맷이 다를 수 있어 공통 포맷으로 강제하지 않음).
-- 흐름 (IAP consume/acknowledge 패턴과 동일)
--  1. reserve  : 사용가능 여부(코드 유효성/사용자당 한도) 검증 통과 시 이 테이블에 행 생성 = 즉시 최종 소모 확정
--                (coupon_campaign.used_qty 도 이 시점에 함께 +1, RANDOM은 coupon_code.status 도 함께 사용완료로 전환)
--  2. (게임서버가 자기 DB에서 실제 보상 지급 처리)
--  3. confirm  : 지급 성공 확인 시점에 confirmed_at 만 기록(상태 전이 아님, 이미 1번에서 소모 확정 끝난 뒤의 결과 기록)
--  4. confirm 이 안 오는 경우에도 쿠폰서버는 되돌리거나 배치를 돌리지 않는다.
--     대신 confirmed_at IS NULL 인 행을 조회하는 API(GET /coupons/unconfirmed, 특정유저/전체유저)를 제공하고,
--     재시도 여부/시점 판단은 전적으로 게임서버 책임이다(쿠폰서버→게임서버 콜백/웹훅 없음).
-- 사용한도 체크 (동시성 주의)
--  coupon_campaign.use_limit_per_user 대비 COUNT(*) WHERE coupon_campaign_id=? AND game_user_id=?
--  (모든 행이 이미 소모 확정 상태이므로 상태값 필터 불필요, RANDOM/FIXED 공통 로직)
--  단, 단순 COUNT 후 INSERT 는 동시 요청 시 한도를 넘길 수 있으므로 반드시
--  "SELECT COUNT(*) ... WHERE coupon_campaign_id=? AND game_user_id=? FOR UPDATE" 로 조회해
--  ix_campaign_user 인덱스 구간에 갭락을 걸어 동시 INSERT 를 직렬화한 뒤 판단해야 한다.
-- project_id (비정규화)
--  game_user_id 는 게임서버가 자체 부여하는 값이라 서로 다른 프로젝트끼리 우연히 겹칠 수 있다
--  (예: 두 게임 모두 플레이어ID로 "12345" 사용). coupon_campaign_id 만으로는 미컨슘 조회 API
--  (GET /coupons/unconfirmed)에서 campaign_id 필터를 생략한 특정유저 조회 시 스코핑할 방법이
--  없어, 다른 프로젝트의 game_user_id 데이터가 섞여 나오는 크로스테넌트 유출 위험이 있다.
--  project_id 를 직접 두면 모든 조회를 "WHERE project_id=? AND ..."로 통일할 수 있고,
--  설령 다른 프로젝트 소속 campaign_id 를 실수로/의도적으로 넘겨도 0건으로 자연스럽게 막힌다.
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `coupon_code_usage`;
CREATE TABLE `coupon_code_usage` (
  `coupon_code_usage_id`	BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '쿠폰 코드 사용 기록 ID',
  `coupon_code_id`			BIGINT		UNSIGNED	NOT NULL															COMMENT '쿠폰 코드 ID (coupon_code.coupon_code_id)',
  `coupon_campaign_id`		BIGINT		UNSIGNED	NOT NULL															COMMENT '캠페인 ID (coupon_campaign.coupon_campaign_id, 사용한도 카운트/미컨슘 조회용 비정규화)',
  `project_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT '소속 프로젝트 ID (project.project_id, coupon_code에서 비정규화 — 미컨슘 조회 API의 크로스테넌트 스코핑용)',
  `game_user_id`			VARCHAR(100)			NOT NULL															COMMENT '게임서버 유저 식별자(원문 문자열 저장, 포맷은 게임서버마다 상이, FK 없음)',
  `confirmed_at`			DATETIME							DEFAULT NULL											COMMENT '지급 성공 확인일시(confirm 완료 시점). NULL이면 미컨슘',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '생성일시(=소모 확정일시)',
  `updated_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP	COMMENT '수정일시',
  PRIMARY KEY (`coupon_code_usage_id`),
  KEY `ix_code_id` (`coupon_code_id`),
  KEY `ix_campaign_user` (`coupon_campaign_id`,`game_user_id`),
  KEY `ix_campaign_confirmed` (`coupon_campaign_id`,`confirmed_at`),
  KEY `ix_project_user_confirmed` (`project_id`,`game_user_id`,`confirmed_at`),
  KEY `ix_project_confirmed` (`project_id`,`confirmed_at`),
  CONSTRAINT `fk_coupon_code_usage_code` FOREIGN KEY (`coupon_code_id`) REFERENCES `coupon_code` (`coupon_code_id`),
  CONSTRAINT `fk_coupon_code_usage_campaign` FOREIGN KEY (`coupon_campaign_id`) REFERENCES `coupon_campaign` (`coupon_campaign_id`),
  CONSTRAINT `fk_coupon_code_usage_project` FOREIGN KEY (`project_id`) REFERENCES `project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 코드 사용 기록 (reserve=즉시 소모 확정, confirm=지급 결과 기록)';
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : log_audit
-- 작성 : 2026.07.15 trisakion
-- 내용 : 관리 콘솔 계정/테넌시 설정 변경 이력을 저장하는 Append-Only 테이블
--        CREATE / UPDATE / STATUS_CHANGE 작업 기록
--        변경 전후 전체 Row를 JSON 형태로 저장
--        대상은 company/project/user/user_role 4개 테이블뿐
--        coupon_campaign/coupon_code는 각자 전용 이벤트 로그(log_coupon_campaign, log_coupon_use)로 관리
--        user_session은 세션 이력 테이블이므로 감사 대상에서 제외
--        물리 수정 및 삭제를 허용하지 않음
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `log_audit`;
CREATE TABLE `log_audit` (
  `idx`						BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '감사 로그 ID',
  `action`					TINYINT		UNSIGNED	NOT NULL															COMMENT '작업 유형 (10:CREATE, 20:UPDATE, 30:STATUS_CHANGE)',
  `company_id`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '회사 ID (로그 스코핑용, FK 없음)',
  `project_id`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '프로젝트 ID (로그 스코핑용, company/user는 NULL, FK 없음)',
  `table_name`				VARCHAR(100)			NOT NULL															COMMENT '대상 테이블명 (company, project, user, user_role)',
  `target_id`				VARCHAR(100)			NOT NULL															COMMENT '대상 PK 값 또는 복합 PK 식별값 (예: 100, {"user_id":100,"project_id":200})',
  `target_name`				VARCHAR(200)			DEFAULT NULL														COMMENT '대상 표시명 스냅샷 (예: 회사명, 프로젝트명, 사용자명)',
  `before_json`				LONGTEXT				DEFAULT NULL														COMMENT '변경 전 데이터(JSON) (CREATE 시 NULL, UPDATE/STATUS_CHANGE 시 수정 전 Row 전체)',
  `after_json`				LONGTEXT				NOT NULL															COMMENT '변경 후 데이터(JSON) (CREATE/UPDATE/STATUS_CHANGE 시 항상 필수)',
  `created_by`				BIGINT		UNSIGNED	NOT NULL															COMMENT '작업 수행 사용자 ID',
  `created_by_name`			VARCHAR(50)				DEFAULT NULL														COMMENT '작업 수행 사용자명 스냅샷 (로그 생성 시점 값 고정, 별도 DB 분리 대비 user 테이블 조인 제거용)',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '로그 생성일시',
  PRIMARY KEY (`idx`),
  KEY `ix_table_target` (`table_name`, `target_id`),
  KEY `ix_company_id` (`company_id`),
  KEY `ix_project_id` (`project_id`),
  KEY `ix_created_by` (`created_by`),
  KEY `ix_created_at` (`created_at`)
  -- CONSTRAINT `fk_log_audit_created_by` FOREIGN KEY (`created_by`) REFERENCES `user` (`user_id`)	-- 로그테이블이므로 FK 사용하지 않음
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='관리 콘솔 계정/테넌시 설정 변경 감사 로그 (company/project/user/user_role 전용, 변경 전후 전체 Row를 JSON 형태로 저장하는 Append-Only 테이블)';
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : log_coupon_campaign
-- 작성 : 2026.07.17 trisakion
-- 내용 : 쿠폰 캠페인 변경 이력 — 플랫폼사용자(운영자) 영역 로그 (Append-Only)
--        log_audit(시스템관리자 영역)과 대상/조회 권한이 달라 별도 테이블로 분리한다.
--        log_audit는 SUPER_ADMIN/DEVELOPER만 조회 가능한데, coupon_campaign은 MANAGER/OPERATOR가
--        직접 다루는 대상이라 log_audit에 합치면 정작 작업 당사자가 자기 이력을 볼 수 없게 된다.
--        CREATE / UPDATE / STATUS_CHANGE / APPROVE / REJECT 작업 시점의 coupon_campaign
--        전체 컬럼을 그대로 스냅샷으로 복제해 저장한다(log_audit의 before/after_json 방식 대신
--        coupon_campaign과 거의 동일한 구조 + action 컬럼으로 구성 — 타입 보존, JSON 파싱 없이
--        특정 시점 특정 컬럼 값을 바로 조회 가능).
--        approved_by/approved_at/reject_reason 은 원본 스냅샷 그대로 유지한다 — 이건 "이 행의
--        행위자"가 아니라 그 시점 캠페인 자체의 승인 상태이므로, 승인 이후에 생기는 다른 액션
--        (예: 승인된 캠페인의 STATUS_CHANGE) 로그 행에서도 "그때 누가 승인해뒀었는지" 히스토리로
--        계속 의미가 있다.
--        물리 수정 및 삭제를 허용하지 않음(log_audit과 동일 원칙).
-- created_by / created_at
--  log_audit과 동일한 관례: 캠페인 원본의 created_by 스냅샷이 아니라 "이 로그 행(액션)을 수행한
--  사용자/시각"이다. CREATE 행은 생성자, UPDATE/STATUS_CHANGE 행은 그 수정을 한 사용자를 담는다
--  — 모든 액션 공통으로 행위자를 나타내므로 별도 updated_by 컬럼이 필요 없다.
-- coupon_campaign_id / project_id 등 (FK 없음)
--  log_audit과 동일하게 로그 테이블은 전체 컬럼에 FK 를 걸지 않는다(원본 삭제/변경과 무관하게
--  로그는 그 시점의 값을 그대로 보존해야 하므로).
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `log_coupon_campaign`;
CREATE TABLE `log_coupon_campaign` (
  `idx`						BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '쿠폰 캠페인 로그 ID',
  `action`					TINYINT		UNSIGNED	NOT NULL															COMMENT '작업 유형 (10:CREATE, 20:UPDATE, 30:STATUS_CHANGE, 40:APPROVE, 50:REJECT)',
  `coupon_campaign_id`		BIGINT		UNSIGNED	NOT NULL															COMMENT '원본 캠페인 ID (FK 없음, 로그 원칙)',
  `project_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT '프로젝트 ID (로그 스코핑용, 원본 스냅샷)',
  `name`					VARCHAR(100)			NOT NULL															COMMENT '캠페인명 (원본 스냅샷)',
  `campaign_start`			DATETIME				NOT NULL															COMMENT '사용 가능 시작일시 (원본 스냅샷)',
  `campaign_end`			DATETIME				NOT NULL															COMMENT '사용 가능 종료일시 (원본 스냅샷)',
  `code_type`				TINYINT		UNSIGNED	NOT NULL															COMMENT '코드 발급 방식 (원본 스냅샷)',
  `use_hyphen`				TINYINT		UNSIGNED	NOT NULL															COMMENT '하이픈 포함 여부 (원본 스냅샷)',
  `requested_qty`			INT			UNSIGNED	NOT NULL															COMMENT '목표 발급 수량 (원본 스냅샷)',
  `generated_qty`			INT			UNSIGNED	NOT NULL															COMMENT '실제 발급 수량 (원본 스냅샷)',
  `usable_qty`				INT			UNSIGNED	NOT NULL															COMMENT '실제 사용 가능 수량 (원본 스냅샷)',
  `used_qty`				INT			UNSIGNED	NOT NULL															COMMENT '실제 사용(소모) 수량 (원본 스냅샷)',
  `use_limit_per_user`		INT			UNSIGNED	NOT NULL															COMMENT '동일 유저 재사용 허용 횟수 (원본 스냅샷)',
  `status`					TINYINT		UNSIGNED	NOT NULL															COMMENT '상태 (원본 스냅샷)',
  `approval_status`			TINYINT		UNSIGNED	NOT NULL															COMMENT '승인상태 (원본 스냅샷)',
  `approved_by`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '승인/반려 처리자 ID (원본 스냅샷)',
  `approved_at`				DATETIME							DEFAULT NULL											COMMENT '승인/반려 처리일시 (원본 스냅샷)',
  `reject_reason`			VARCHAR(500)						DEFAULT NULL											COMMENT '반려 사유 (원본 스냅샷)',
  `reward_data`				JSON					NOT NULL															COMMENT '보상 내용 (원본 스냅샷)',
  `created_by`				BIGINT		UNSIGNED	NOT NULL															COMMENT '이 로그 행(액션)을 수행한 사용자 ID',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '이 로그 행(액션)이 발생한 시각',
  PRIMARY KEY (`idx`),
  KEY `ix_campaign` (`coupon_campaign_id`),
  KEY `ix_project_created` (`project_id`,`created_at`),
  KEY `ix_action` (`action`),
  KEY `ix_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 캠페인 변경 이력 (coupon_campaign 전체 컬럼 스냅샷 + action, Append-Only)';
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : log_coupon_use
-- 작성 : 2026.07.17 trisakion
-- 내용 : 쿠폰 사용(reserve/confirm) 시도 이력 — 유저 영역 로그 (Append-Only)
--        coupon_code_usage 는 성공한 소모 건만 남기지만, 이 테이블은 실패한 시도까지
--        전부 기록한다(부정사용 탐지: 코드 브루트포스, 한도 우회 시도 등 / 운영 디버깅 목적).
--        RESERVE/CONFIRM 요청 모두 기록 대상.
--        물리 수정 및 삭제를 허용하지 않음(log_audit과 동일 원칙).
-- code_value (FK 아님)
--  존재하지 않는 코드로 시도한 요청도 그대로 남겨야 브루트포스 탐지가 가능하므로,
--  coupon_code 에 대한 FK 대신 시도한 문자열 원문을 그대로 저장한다.
-- coupon_campaign_id (NULL 허용, FK 없음)
--  코드 자체가 존재하지 않는 시도는 캠페인을 특정할 수 없어 NULL. log_audit과 동일하게
--  로그 테이블은 스코핑용 컬럼에 FK 를 걸지 않는다.
-- result_type (잠정, TODO #2 API 상세 스펙 확정 시 재검토)
--  reserve/confirm API 의 실제 result 코드 체계가 아직 확정 전이라 우선 대표 사유만 정의한다.
--  0:성공, 10:코드없음(RESERVE), 20:이미소모/중지(RESERVE), 30:캠페인 사용불가(RESERVE),
--  40:사용자한도초과(RESERVE), 50:소모기록없음(CONFIRM 전용, reserve 안 된 코드에 confirm)
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `log_coupon_use`;
CREATE TABLE `log_coupon_use` (
  `idx`						BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '쿠폰 사용 시도 로그 ID',
  `action`					TINYINT		UNSIGNED	NOT NULL															COMMENT '요청 유형 (10:RESERVE, 20:CONFIRM)',
  `project_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT '프로젝트 ID (로그 스코핑용, FK 없음)',
  `coupon_campaign_id`		BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '캠페인 ID (코드 자체가 없는 시도는 특정 불가하여 NULL 허용, FK 없음)',
  `code_value`				VARCHAR(50)				NOT NULL															COMMENT '시도한 쿠폰 코드 문자열 원문 (존재하지 않는 코드도 그대로 기록, FK 아님)',
  `game_user_id`			VARCHAR(100)			NOT NULL															COMMENT '게임서버 유저 식별자 (원문 문자열, FK 없음)',
  `result_type`				TINYINT		UNSIGNED	NOT NULL															COMMENT '처리 결과 (0:성공, 10:코드없음, 20:이미소모/중지, 30:캠페인 사용불가, 40:사용자한도초과, 50:소모기록없음(CONFIRM 전용)) — 잠정, API 스펙 확정 시 재검토',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '시도 일시',
  PRIMARY KEY (`idx`),
  KEY `ix_project_created` (`project_id`,`created_at`),
  KEY `ix_code_value` (`code_value`),
  KEY `ix_game_user` (`game_user_id`),
  KEY `ix_result_type` (`result_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 사용(reserve/confirm) 시도 이력 (성공/실패 전체, Append-Only)';
SET FOREIGN_KEY_CHECKS = 1;
