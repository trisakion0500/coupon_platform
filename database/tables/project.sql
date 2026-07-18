-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : project
-- 작성 : 2026.07.11 trisakion
-- 수정 : 2026.07.18 trisakion — api_secret_hash(단방향 SHA-256) -> api_secret(AES-256-CBC 가역 암호화)
-- 내용 : 서비스 프로젝트 정보
-- api_secret (가역 암호화, 단방향 해시 아님)
--  S2S 인증을 HMAC-SHA256 요청 서명 방식으로 확정하면서(docs/07_AUTH_SECURITY.md 2장), 서버가
--  서명을 검증하려면 매 요청마다 원문 Secret으로 HMAC을 재계산해야 한다 — 단방향 해시로는
--  원문을 복원할 수 없어 이 방식 자체가 불가능하므로, phone_number(user 테이블)와 동일하게
--  AES-256-CBC(Base64, ENCRYPTION_KEY)로 가역 암호화해 저장한다. 평문이 API 응답에 노출되는
--  시점(발급/재발급 1회)은 기존과 동일하고, 그 외 조회 API는 여전히 평문/암호문 모두 반환하지 않는다.
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
INSERT INTO `project` (`project_id`, `company_id`, `project_code`, `project_name`, `description`, `api_key`, `api_secret`, `status`, `created_at`, `updated_at`)
VALUES
(1, 1, 'ADMIN_PROJECT', 'Administrator Company Default Project', NULL, 'dev-admin-project-api-key', 'U2FsdGVkX18k7f3qz9pQwK2vXeYtBjE1oNc5rM8hZdA=', 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00'),
(2, 2, 'DEV_PROJECT',   'Developer Company Default Project',     NULL, 'dev-dev-project-api-key',   'U2FsdGVkX1+aBcD3fGh6IjK9lMnOpQr2StUvWxYz012=', 1, '1970-01-01 00:00:00', '1970-01-01 00:00:00');
SET FOREIGN_KEY_CHECKS = 1;