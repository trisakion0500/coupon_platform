-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : user_role
-- 작성 : 2026.07.15 trisakion
-- 내용 : 사용자 - 프로젝트 권한 매핑 (10단위 role 레벨 코드)
-- 의도적 복합 PK (user_id, project_id) - 단일 대리키(AUTO_INCREMENT) 대신 자연키를 그대로 PK로 사용한다.
--  이 테이블을 FK로 참조하는 다른 테이블이 없고(순수 M:N 매핑의 말단 테이블), (user_id, project_id)
--  조합 자체가 "유저당 프로젝트별 role은 1개"라는 완전한 자연키라 대리키를 따로 둘 이유가 없다.
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