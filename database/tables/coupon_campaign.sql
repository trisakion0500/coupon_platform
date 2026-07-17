-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : coupon_campaign
-- 작성 : 2026.07.16 trisakion
-- 내용 : 쿠폰 캠페인 정책 정보
--        실제 코드 값은 code_type 무관하게 항상 coupon_code 테이블에만 저장(중복 저장 없음)
-- 코드 발급 방식
--  - 1:RANDOM    > 1회 사용 가능한 coupon_code 생성
--  - 2:FIXED     > n회 사용 가능한 coupon_code 생성
-- 쿠폰 코드 하이픈 포함 여부
--  * 코드 발급 방식
--   - 1:RANDOM    > 선택 가능
--   - 2:FIXED     > 선택 불가(사용자가 입력한 문구 그대로 사용함)
-- 목표 발급 수량(관리자가 정한 쿠폰 수량) / 실제 발급 수량(시스템이 실제 발급한 수량)
--  * 코드 발급 방식
--   - 1:RANDOM    > 목표 발급 수량만큼 랜덤한 쿠폰코드를 생성한 수량 갱신
--   - 2:FIXED     > 관리자가 정한 쿠폰코드로 단 하나의 쿠폰을 생성하고 목표 발급 수량으로 수정
-- 실제 사용 가능 수량(usable_qty)
--  선착순 오픈처럼 generated_qty(전체 발급분)보다 적게 열어두는 용도(예: 1000개 발급하고 500개만 우선 오픈).
--  reserve 성공 시 used_qty 가 같은 트랜잭션에서 원자적으로 +1 되므로(coupon_code_usage 참고),
--  가용 여부 판단은 used_qty(컬럼값) 대 usable_qty 단순 비교로 충분하다(실시간 COUNT 쿼리 불필요).
-- 동시성(오버셀 방지)
--  reserve 시 "UPDATE coupon_campaign SET used_qty=used_qty+1
--             WHERE used_qty<usable_qty AND status=2 AND NOW() BETWEEN campaign_start AND campaign_end"
--  조건부 갱신 하나로 수량/상태(활성)/기간을 동시에 원자적으로 체크한다.
--  status/기간 조건을 같은 UPDATE 에 포함시키면 관리자가 캠페인을 일시중지/종료시키는 시점과
--  겹치는 reserve 요청도 추가 비용 없이 함께 막힌다(별도 락 불필요).
-- 쿠폰 코드 생성 (RANDOM 전용, FIXED는 관리자 입력값 그대로 사용)
--  - nanoid.customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 12)().match(/.{1,4}/g)?.join('-') > XXXX-XXXX-XXXX
-- 승인 워크플로우 (approval_status, status와 별개 축)
--  status(대기/활성/일시중지/종료)는 캠페인의 라이프사이클, approval_status는 그 캠페인을
--  실제로 활성화해도 되는지에 대한 승인 여부다. 둘을 분리하지 않으면 "시작일 전이라 대기중인
--  승인된 캠페인"과 "승인 자체가 안 된 캠페인"을 같은 값(status=1)으로 표현하게 되어 구분이 안 된다.
--  - MANAGER 이상이 생성/컨트롤 → approval_status=1(승인불요)로 즉시 시작, 승인 절차 없음
--  - OPERATOR가 생성/컨트롤    → approval_status=2(승인대기)로 시작, 10/20/30이 승인/반려
--  - status를 2(활성)로 전환하는 SP는 approval_status IN (1,3)(승인불요/승인완료)일 때만 허용한다.
--    reserve 시점의 조건부 UPDATE(위 동시성 절)는 status=2만 체크하면 되고 approval_status를
--    매번 다시 검사할 필요는 없다 — 애초에 미승인 캠페인은 status=2에 도달할 수 없기 때문.
--  변경 이력(누가 언제 승인/반려했는지)은 log_coupon_campaign에 append-only로 별도 기록한다.
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `coupon_campaign`;
CREATE TABLE `coupon_campaign` (
  `coupon_campaign_id`		BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '캠페인 ID',
  `project_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT 'project.project_id 소속 게임 ID',
  `name`					VARCHAR(100)			NOT NULL															COMMENT '캠페인명',
  `campaign_start`			DATETIME				NOT NULL															COMMENT '사용 가능 시작일시',
  `campaign_end`			DATETIME				NOT NULL															COMMENT '사용 가능 종료일시',
  `code_type`				TINYINT		UNSIGNED	NOT NULL															COMMENT '코드 발급 방식 (1:RANDOM, 2:FIXED)',
  `use_hyphen`				TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '쿠폰 코드 하이픈 포함 여부 (1:포함, 0:미포함). RANDOM에만 적용, FIXED는 사용자입력값 그대로 사용',
  `requested_qty`			INT			UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '목표 발급 수량',
  `generated_qty`			INT			UNSIGNED	NOT NULL	DEFAULT 0												COMMENT '실제 발급 수량',
  `usable_qty`				INT			UNSIGNED	NOT NULL	DEFAULT 0												COMMENT '실제 사용 가능 수량(선착순 오픈 등으로 generated_qty보다 적을 수 있음)',
  `used_qty`				INT			UNSIGNED	NOT NULL	DEFAULT 0												COMMENT '실제 사용(소모) 수량(reserve 성공 시점 즉시 확정 기준, confirm 여부와 무관)',
  `use_limit_per_user`		INT			UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '동일 유저 재사용 허용 횟수',
  `status`					TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '상태 (1:대기, 2:활성, 3:일시중지, 4:종료)',
  `approval_status`			TINYINT		UNSIGNED	NOT NULL	DEFAULT 2												COMMENT '승인상태 (1:승인불요, 2:승인대기, 3:승인완료, 4:반려) — status와 별개 축, fail-safe 기본값은 승인대기',
  `approved_by`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '승인/반려 처리자 계정 ID (user.user_id)',
  `approved_at`				DATETIME							DEFAULT NULL											COMMENT '승인/반려 처리일시',
  `reject_reason`			VARCHAR(500)						DEFAULT NULL											COMMENT '반려 사유',
  `reward_data`				JSON					NOT NULL															COMMENT '보상 내용(아이템/재화 등 자유 스키마, 쿠폰서버는 해석하지 않고 그대로 pass-through)',
  `created_by`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '생성자 계정 ID (user.user_id)',
  `updated_by`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '수정자 계정 ID (user.user_id)',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '생성일시',
  `updated_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP	COMMENT '수정일시',
  PRIMARY KEY (`coupon_campaign_id`),
  KEY `ix_project_status` (`project_id`,`status`),
  KEY `ix_project_approval_status` (`project_id`,`approval_status`),
  KEY `ix_code_type` (`code_type`),
  CONSTRAINT `fk_coupon_campaign_project` FOREIGN KEY (`project_id`) REFERENCES `project` (`project_id`),
  CONSTRAINT `fk_coupon_campaign_created_by` FOREIGN KEY (`created_by`) REFERENCES `user` (`user_id`),
  CONSTRAINT `fk_coupon_campaign_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `user` (`user_id`),
  CONSTRAINT `fk_coupon_campaign_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 캠페인 정책 정보';
SET FOREIGN_KEY_CHECKS = 1;
