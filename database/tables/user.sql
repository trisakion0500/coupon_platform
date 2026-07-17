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