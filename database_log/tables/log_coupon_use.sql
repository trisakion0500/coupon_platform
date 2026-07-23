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
-- result_type (대표 사유만 정의한 축약 코드, API result 코드와는 별개 체계)
--  0:성공, 10:코드없음(RESERVE/CONFIRM 공통, API 31005), 20:이미소모/중지(RESERVE, API 33001),
--  30:캠페인 사용불가(RESERVE, API 33002), 40:사용자한도초과(RESERVE, API 33003),
--  50:소모기록없음(CONFIRM 전용, reserve 안 된 코드에 confirm, API 31006)
--  API 상세 스펙 및 매핑표: docs/18_COUPON_USAGE_API.md 4장
-- caller_ip (NULL 허용, 2026-07-23 추가)
--  이 엔드포인트를 호출한 게임서버의 IP(Express req.ip, main.ts trust proxy=1 설정으로 로드밸런서
--  뒤에서도 실제 호출자 IP를 얻는다) — 이미 HMAC 서명으로 강하게 인증되므로 인증 목적이 아니라,
--  "이 프로젝트의 API Secret이 평소와 다른 IP에서 호출되기 시작했다" 같은 이상징후 탐지·장애
--  조사 보조 신호용. 브루트포스를 시도하는 실제 최종 플레이어의 IP가 아니라 그 요청을 대신 전달한
--  게임서버 자신의 IP라는 점에 유의 — 최종 플레이어 추적은 game_user_id로 한다.
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
  `result_type`				TINYINT		UNSIGNED	NOT NULL															COMMENT '처리 결과 (0:성공, 10:코드없음, 20:이미소모/중지, 30:캠페인 사용불가, 40:사용자한도초과, 50:소모기록없음(CONFIRM 전용)) — API result 코드 매핑은 docs/18_COUPON_USAGE_API.md 4장 참고',
  `caller_ip`				VARCHAR(45)				DEFAULT NULL											COMMENT '호출한 게임서버의 IP(IPv6 포함, req.ip). 인증 목적 아님 - 이상징후 탐지/장애조사 보조용',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '시도 일시',
  PRIMARY KEY (`idx`),
  KEY `ix_project_created` (`project_id`,`created_at`),
  KEY `ix_code_value` (`code_value`),
  KEY `ix_game_user` (`game_user_id`),
  KEY `ix_result_type` (`result_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 사용(reserve/confirm) 시도 이력 (성공/실패 전체, Append-Only)';
SET FOREIGN_KEY_CHECKS = 1;
