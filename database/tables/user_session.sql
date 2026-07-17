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
