-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : project_api_nonce
-- 작성 : 2026.07.18 trisakion
-- 내용 : S2S(게임서버 -> 쿠폰서버) HMAC 요청 서명의 재전송(replay) 방지용 1회성 nonce 저장소.
--        docs/06_AUTH_SECURITY.md 2장 참고 — X-API-Nonce 헤더값을 서명 검증 통과 후 이 테이블에
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
