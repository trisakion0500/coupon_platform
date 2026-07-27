-- ------------------------------------------------------------------------------------------------------------ --
-- 메인 서비스 DB(coupon_platform) 통합 테이블 파일. 로그 테이블(log_audit/log_coupon_campaign/log_coupon_use)은
-- 2026.07.19부터 로컬 개발 환경에서도 물리적으로 분리된 별도 DB(coupon_platform_log)에 둔다
-- (04_DEV_CONVENTIONS.md 1장 참고) — 해당 DDL은 database_log/tables/all_log_tables.sql에 있다.
-- ------------------------------------------------------------------------------------------------------------ --
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
-- 수정1: 2026.07.18 trisakion — api_secret_hash(단방향 SHA-256) -> api_secret(AES-256-CBC 가역 암호화)
-- 수정2: 2026.07.21 trisakion — edit_count(낙관적 동시성 제어) 신설
-- 내용 : 서비스 프로젝트 정보
-- api_secret (가역 암호화, 단방향 해시 아님)
--  S2S 인증을 HMAC-SHA256 요청 서명 방식으로 확정하면서(docs/09_AUTH_SECURITY.md 2장), 서버가
--  서명을 검증하려면 매 요청마다 원문 Secret으로 HMAC을 재계산해야 한다 — 단방향 해시로는
--  원문을 복원할 수 없어 이 방식 자체가 불가능하므로, phone_number(user 테이블)와 동일하게
--  AES-256-CBC(Base64, ENCRYPTION_KEY)로 가역 암호화해 저장한다. 평문이 API 응답에 노출되는
--  시점(발급/재발급 1회)은 기존과 동일하고, 그 외 조회 API는 여전히 평문/암호문 모두 반환하지 않는다.
-- 낙관적 동시성 제어 (edit_count, 2026-07-21 추가, coupon_campaign과 동일 패턴)
--  `SP_PROJECT_API_SECRET_ROTATE`가 버전 체크 없이 무조건 실행되는 걸 리뷰에서 발견 — 더블클릭이나
--  타임아웃 재시도로 거의 동시에 두 번 재발급되면, 아직 유효했던 이전 api_secret_prev(grace
--  period 중)가 조용히 유실될 수 있었다(슬롯이 하나뿐이라 두 번째 재발급이 첫 번째가 막 만든 값으로
--  덮어씀). `SP_PROJECT_UPDATE`도 동일하게 버전 체크가 전혀 없는 순수 last-write-wins였다. 두 SP
--  모두 같은 project 행을 건드리므로 coupon_campaign.edit_count와 동일한 방식으로 통일한다 —
--  `updated_at`을 재사용하지 않는 이유도 동일(DATETIME 초 단위 정밀도로 같은 초 안의 충돌을 놓칠 수
--  있음, coupon_campaign.sql 헤더 주석 참고). `SP_PROJECT_UPDATE`/`SP_PROJECT_API_SECRET_ROTATE`
--  둘 다 성공 시 `edit_count = edit_count + 1`을 실행하고, 클라이언트는 마지막 조회 시 받은 값을
--  요청에 그대로 실어 보낸다 — 불일치 시 30005(동시 수정 충돌)로 거부한다.
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
  `api_secret`				VARCHAR(255)			NOT NULL															COMMENT '현재 사용중인 API Secret (AES-256-CBC 암호화(Base64)) — HMAC 서명 검증 시 복호화해서 사용',
  `api_secret_prev`		VARCHAR(255)						DEFAULT NULL											COMMENT '직전 API Secret 암호화값 (재발급 후 유예기간 동안만 유지, 유예기간 경과 시 배치로 NULL 처리)',
  `secret_rotated_at`		DATETIME							DEFAULT NULL											COMMENT '마지막 Secret 재발급 시각 (NULL이면 최초 발급 후 미변경)',
  `status`					TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '상태 (1:사용, 0:중지)',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '생성일시',
  `updated_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP	COMMENT '수정일시',
  `edit_count`				INT			UNSIGNED	NOT NULL	DEFAULT 0												COMMENT '낙관적 동시성 제어용 수정 횟수(매 수정마다 +1, PATCH/재발급 요청은 이 값을 그대로 실어 보내야 함 - 위 헤더 주석 참고)',
  PRIMARY KEY (`project_id`),
  UNIQUE KEY `uk_company_project_code` (`company_id`,`project_code`),
  UNIQUE KEY `uk_project_api_key` (`api_key`),
  KEY `ix_project_company_id` (`company_id`),
  KEY `ix_status` (`status`),
  CONSTRAINT `fk_project_company_id` FOREIGN KEY (`company_id`) REFERENCES `company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='서비스 프로젝트 정보';
-- api_secret 시드값은 개발 환경용 플레이스홀더(AES-256-CBC(Base64) 형식만 흉내낸 값)다.
-- 실제 ENCRYPTION_KEY로 암호화된 값이 아니므로 로컬에서 실제 서명 검증까지 확인하려면
-- 프로젝트 생성/Secret 재발급 API로 다시 발급받아야 한다.
INSERT INTO `project` (`project_id`, `company_id`, `project_code`, `project_name`, `description`, `api_key`, `api_secret`, `status`, `created_at`, `updated_at`, `edit_count`)
VALUES
(1, 1, 'ADMIN_PROJECT', 'Administrator Company Default Project', NULL, 'dev-admin-project-api-key', 'U2FsdGVkX18k7f3qz9pQwK2vXeYtBjE1oNc5rM8hZdA=', 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00', 0),
(2, 2, 'DEV_PROJECT',   'Developer Company Default Project',     NULL, 'dev-dev-project-api-key',   'U2FsdGVkX1+aBcD3fGh6IjK9lMnOpQr2StUvWxYz012=', 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00', 0);
SET FOREIGN_KEY_CHECKS = 1;
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : project_api_nonce
-- 작성 : 2026.07.18 trisakion
-- 내용 : S2S(게임서버 -> 쿠폰서버) HMAC 요청 서명의 재전송(replay) 방지용 1회성 nonce 저장소.
--        docs/09_AUTH_SECURITY.md 2장 참고 — X-API-Nonce 헤더값을 서명 검증 통과 후 이 테이블에
--        (project_id, nonce) 조합으로 INSERT 시도하고, UNIQUE 제약 위반이면 재사용(재전송)으로 판단해
--        거부한다. INSERT-then-check가 아니라 INSERT 자체의 유니크 제약 위반을 이용하는 것이므로
--        동시에 같은 nonce로 두 요청이 들어와도 원자적으로 하나만 성공한다(경쟁 상태 없음).
-- 보관 기간 (짧고 빈번한 정리 필요 — 로그 테이블과 다른 정리 주기)
--  nonce는 X-API-Timestamp 허용범위(S2S_TIMESTAMP_TOLERANCE_SEC, 기본 300초) 밖으로 나가면
--  타임스탬프 검증 자체에서 이미 거부되므로, 그 이후에는 같은 nonce라도 재사용될 위험이 없다.
--  따라서 이 테이블은 허용범위만큼만 데이터를 보관하면 충분하고, log_* 테이블처럼 장기 보관하지
--  않는다. reserve/confirm 트래픽이 많으면 행 수가 빠르게 늘 수 있어(호출마다 1행) 정리 배치는
--  session cleanup(1일 1회)보다 훨씬 잦은 주기로 돈다(S2S_NONCE_CLEANUP_CRON, 기본 10분 간격) —
--  created_at 이 (NOW() - S2S_TIMESTAMP_TOLERANCE_SEC)보다 과거인 행을 물리 삭제한다.
-- FK 적용 (로그 테이블과 달리 FK를 건다)
--  이 테이블은 감사/이력 목적이 아니라 실시간 보안 검증에 쓰이는 기능 테이블이라, 로그 테이블의
--  "FK 미적용" 원칙(CLAUDE.md 참고) 대상이 아니다 — project 참조 무결성을 그대로 강제한다.
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `project_api_nonce`;
CREATE TABLE `project_api_nonce` (
  `project_api_nonce_id`	BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT 'Nonce 저장 행 ID',
  `project_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT '프로젝트 ID (project.project_id)',
  `nonce`					VARCHAR(64)				NOT NULL															COMMENT 'X-API-Nonce 헤더값 원문 (게임서버가 요청마다 새로 생성, 형식 강제 없음)',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '수신일시 (정리 배치의 기준 컬럼)',
  PRIMARY KEY (`project_api_nonce_id`),
  UNIQUE KEY `uk_project_nonce` (`project_id`,`nonce`),
  KEY `ix_created_at` (`created_at`),
  CONSTRAINT `fk_project_api_nonce_project` FOREIGN KEY (`project_id`) REFERENCES `project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='S2S HMAC 요청 재전송 방지용 nonce 저장소 (짧은 보관 후 배치 정리)';
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
-- phone_number 시드값은 project.sql의 api_secret과 동일한 개발용 플레이스홀더다(실제 ENCRYPTION_KEY로
-- 암호화된 값이 아님) — ENCRYPTION_KEY는 환경마다 달라 이 DDL에 특정 키로 암호화한 값을 고정 커밋할 수
-- 없다. 이 DDL 적용 후 `npm run fix-seed-phone`(backend, 2026-07-19 추가)을 실행하면 로컬 .env의
-- ENCRYPTION_KEY로 sa/dev/mgr/op phone_number를 실제 복호화 가능한 값으로 갱신한다(GET /auth/me 등
-- 복호화 경로 테스트 시 필요).
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
--  - status를 2(활성)로 전환하는 SP는 approval_status IN (1,3)(승인불요/승인완료) AND
--    campaign_end > NOW()(2026-07-25 추가 - 이미 사용기간이 지난 캠페인이 활성 상태로 진입하는
--    것 자체를 막음, 19_CAMPAIGN_API.md 2.5 참고)일 때만 허용한다.
--    reserve 시점의 조건부 UPDATE(위 동시성 절)는 status=2만 체크하면 되고 approval_status를
--    매번 다시 검사할 필요는 없다 — 애초에 미승인 캠페인은 status=2에 도달할 수 없기 때문.
--  변경 이력(누가 언제 승인/반려했는지)은 log_coupon_campaign에 append-only로 별도 기록한다.
-- 코드 생성 진행상태 (generation_status, status/approval_status와 별개 축)
--  캠페인 생성(POST /campaigns)과 코드 발급(POST /campaigns/{id}/codes)은 별도 API로 분리되어 있다.
--  - RANDOM: 대량생성이라 비동기로 처리 — 1:대기(코드 발급 요청 전) → 2:진행중 → 3:완료 또는 4:실패
--            캠페인당 코드 생성 요청은 1회만 허용(추가 발급/top-up 불가) — job과 campaign이 항상 1:1이라
--            별도 job 테이블 없이 이 컬럼만으로 진행상태를 표현 가능하다.
--  - FIXED: 관리자가 코드 목록을 직접 입력/업로드하는 동기 처리라 진행상태 개념이 없다 —
--           등록 요청 즉시 결과가 나오므로 성공 시 바로 3(완료)으로 기록한다.
--  4(실패)는 "재시도로도 복구 안 된 최종 실패"만 의미한다. 코드값 충돌(nanoid 우연 중복)은 즉시
--  재생성으로 처리하고, DB 커넥션 끊김 등 일시적 오류는 exponential backoff+jitter 재시도 래퍼로
--  흡수한다 — 그 재시도를 다 소진했을 때만 4로 전이하고 generation_error에 사유를 남긴다(개별
--  재시도 시도 자체는 이 컬럼에 남기지 않음, 애플리케이션 로그로 충분).
--  재시도 API(POST /campaigns/{id}/codes/retry)는 4(실패) 상태에서만 허용하며, 이미 생성된
--  generated_qty만큼의 코드는 그대로 두고 남은 수량(requested_qty - generated_qty)만 이어서 생성한다
--  (이미 생성된 코드는 UNIQUE 제약으로 보호되는 정상 데이터라 버릴 이유가 없음).
--  전이는 조건부 UPDATE로 원자성을 보장한다: 예) 재시도 트리거 시
--  "UPDATE coupon_campaign SET generation_status=2 WHERE coupon_campaign_id=? AND generation_status=4"
-- 낙관적 동시성 제어 (edit_count, 2026-07-20 추가)
--  PATCH /campaigns/{id}(SP_CAMPAIGN_UPDATE)는 여러 필드를 한 번에 바꾸고 그 중 일부(승인상태
--  재전환 등)는 "수정 직전 상태"에 따라 분기하는 로직이 있어, 단순 조건부 UPDATE만으로는
--  "그 사이 다른 관리자가 승인/반려/상태변경을 먼저 했는지"까지 못 잡는다. 처음엔 updated_at
--  (자동 갱신 컬럼)을 그대로 낙관적 락 토큰으로 재사용했으나, DATETIME이 초 단위까지만 기록돼
--  같은 초 안에 두 수정이 겹치면(예: 승인 처리 직후 같은 초에 들어온 수정) 값이 안 바뀐 것처럼
--  보여 충돌을 놓치는 사례가 실제로 재현됨 — 그래서 타이밍에 전혀 의존하지 않는 전용 정수
--  카운터를 별도로 둔다. 이 캠페인 행을 바꾸는 SP(UPDATE/CHANGE_STATUS/APPROVE/REJECT) 전부가
--  성공 시 `edit_count = edit_count + 1`을 실행하고, 클라이언트는 마지막으로 조회했을 때 받은
--  값을 요청에 그대로 실어 보낸다 — SP는 WHERE절에 `edit_count = 받아온 값`을 조건으로 걸어,
--  그 사이 이 행을 건드린 SP가 하나라도 있었다면(어떤 필드가 바뀌었든) 정확히 감지해 30005
--  (동시 수정 충돌)로 거부한다. MySQL의 행 단위 락이 UPDATE 간 순서를 직렬화해주므로 두 요청이
--  아무리 가깝게 들어와도 이 값 하나로 충돌을 확실하게 잡을 수 있다(19_CAMPAIGN_API.md 2.4
--  Concurrency 참고).
-- 사용기간 만료 자동 종료 (SP_CAMPAIGN_EXPIRE, 2026-07-25 추가)
--  status=2(활성) AND approval_status IN(1,3) AND campaign_end<=NOW()인 캠페인을 배치
--  (CampaignExpiryService, CAMPAIGN_EXPIRY_CRON)가 주기적으로 status=4(종료)로 전환한다 —
--  기간이 지났는데도 화면엔 "활성"으로 남아있는 상태를 없애기 위함(reserve는 이미 자체
--  시간조건으로 막혀있어 정합성 문제는 아니고 순수 표시 문제). status=1(대기)은 대상이
--  아니다 — 관리자가 나중에 쓰려고 일부러 활성화하지 않은 캠페인까지 건드리지 않는다.
--  updated_by는 NULL로 남기지만(이 컬럼은 원래 nullable), log_coupon_campaign.created_by는
--  NOT NULL이라 배치는 created_by=0/created_by_name='SYSTEM' sentinel로 기록한다(사람이 아닌
--  시스템이 한 액션이라는 뜻, 04_DEV_CONVENTIONS.md 4.2). 상세는 19_CAMPAIGN_API.md 5장,
--  SP_CAMPAIGN_EXPIRE 헤더 주석 참고. 이 조건에 맞는 후보를 빠르게 찾기 위해
--  ix_status_campaign_end(status, campaign_end) 인덱스를 함께 추가했다.
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
  `generation_status`		TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '코드 생성 진행상태 (1:대기, 2:진행중, 3:완료, 4:실패) — status/approval_status와 별개 축, FIXED는 동기 처리라 등록 즉시 3으로 확정',
  `generation_error`		VARCHAR(500)						DEFAULT NULL											COMMENT '코드 생성 최종 실패 사유 (재시도 소진 시에만 기록)',
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
  `edit_count`				INT			UNSIGNED	NOT NULL	DEFAULT 0												COMMENT '낙관적 동시성 제어용 수정 횟수(매 수정마다 +1, PATCH 요청은 이 값을 그대로 실어 보내야 함 - 위 헤더 주석 참고)',
  PRIMARY KEY (`coupon_campaign_id`),
  KEY `ix_project_status` (`project_id`,`status`),
  KEY `ix_project_approval_status` (`project_id`,`approval_status`),
  KEY `ix_project_generation_status` (`project_id`,`generation_status`),
  KEY `ix_code_type` (`code_type`),
  KEY `ix_status_campaign_end` (`status`,`campaign_end`),
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
