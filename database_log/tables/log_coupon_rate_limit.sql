-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : log_coupon_rate_limit
-- 작성 : 2026.08.05 trisakion
-- 내용 : 쿠폰 사용(reserve/confirm) 레이트리밋 초과(429) 이력 — Append-Only
--        프로젝트 단위(CouponUsageRateLimitMiddleware, in-memory 토큰버킷)/유저 단위
--        (CouponUsageUserRateLimitMiddleware, Redis 슬라이딩 윈도우 카운터) 두 미들웨어가
--        리젝트할 때마다 기록한다. 회사 단위 스코프는 아직 구현 전이라 코드값을 미리
--        예약하지 않는다 — 실제로 만들 때 limit_scope에 새 값을 추가하면 된다(TINYINT라
--        마이그레이션 불필요).
-- project_id / company_id 해석 경로
--  리젝트 시점엔 아직 S2sAuthGuard의 서명 검증 전이라 원문 api_key 헤더값만 있다. Redis
--  캐시(project:apikey:{api_key}, 프로젝트 생성 시 write-through로 채움) 우선 조회, 캐시
--  미스 시 SP_PROJECT_GET_IDENTITY_BY_API_KEY로 폴백해서 채운다. api_key 자체가 어느
--  프로젝트에도 속하지 않는 경우(스캐닝성 트래픽 등)는 끝내 NULL로 남는다.
-- 물리 삭제 금지, FK 없음 (log_audit/log_coupon_use와 동일 원칙)
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `log_coupon_rate_limit`;
CREATE TABLE `log_coupon_rate_limit` (
  `idx`					BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '레이트리밋 초과 로그 ID',
  `limit_scope`			TINYINT		UNSIGNED	NOT NULL															COMMENT '리밋 종류 (10:PROJECT-CouponUsageRateLimitMiddleware 토큰버킷, 20:USER-CouponUsageUserRateLimitMiddleware Redis 슬라이딩윈도우)',
  `action`				TINYINT		UNSIGNED	NOT NULL															COMMENT '요청 유형 (10:RESERVE, 20:CONFIRM) — log_coupon_use.action과 동일 코드 재사용',
  `api_key`				VARCHAR(64)				NOT NULL															COMMENT '요청 헤더 원문 API Key (project.api_key, 식별자 성격이라 마스킹 없음 — 시크릿인 api_secret과 다름)',
  `project_id`			BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '해석된 프로젝트 ID (Redis 캐시 또는 SP_PROJECT_GET_IDENTITY_BY_API_KEY 폴백으로 조회, 존재하지 않는 api_key면 NULL, FK 없음)',
  `company_id`			BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '해석된 회사 ID (project_id와 같은 경로로 조회, FK 없음) — 회사 단위 집계를 이 테이블만으로 GROUP BY 가능하게 하기 위한 비정규화',
  `game_user_id`		VARCHAR(100)			DEFAULT NULL															COMMENT 'USER 스코프에서만 채움(요청 바디 원문 그대로, 조회 불필요) — PROJECT 스코프는 NULL, FK 없음',
  `retry_after_sec`		SMALLINT	UNSIGNED	NOT NULL															COMMENT '거부 시점에 클라이언트에 반환한 Retry-After 값(초)',
  `caller_ip`				VARCHAR(45)				DEFAULT NULL											COMMENT '호출한 게임서버의 IP(req.ip) — log_coupon_use.caller_ip와 동일 성격, 인증 목적 아님',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '리젝트 발생 일시',
  PRIMARY KEY (`idx`),
  KEY `ix_limit_scope_created` (`limit_scope`,`created_at`),
  KEY `ix_project_created` (`project_id`,`created_at`),
  KEY `ix_company_created` (`company_id`,`created_at`),
  KEY `ix_game_user` (`game_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 사용 레이트리밋 초과 이력 (프로젝트/유저 단위, Append-Only)';
SET FOREIGN_KEY_CHECKS = 1;
