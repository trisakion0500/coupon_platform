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
