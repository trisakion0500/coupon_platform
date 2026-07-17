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