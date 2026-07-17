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