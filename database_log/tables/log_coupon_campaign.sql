-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : log_coupon_campaign
-- 작성 : 2026.07.17 trisakion
-- 내용 : 쿠폰 캠페인 변경 이력 — 플랫폼사용자(운영자) 영역 로그 (Append-Only)
--        log_audit(시스템관리자 영역)과 대상/조회 권한이 달라 별도 테이블로 분리한다.
--        log_audit는 SUPER_ADMIN/DEVELOPER만 조회 가능한데, coupon_campaign은 MANAGER/OPERATOR가
--        직접 다루는 대상이라 log_audit에 합치면 정작 작업 당사자가 자기 이력을 볼 수 없게 된다.
--        CREATE / UPDATE / STATUS_CHANGE / APPROVE / REJECT 작업 시점의 coupon_campaign
--        전체 컬럼을 그대로 스냅샷으로 복제해 저장한다(log_audit의 before/after_json 방식 대신
--        coupon_campaign과 거의 동일한 구조 + action 컬럼으로 구성 — 타입 보존, JSON 파싱 없이
--        특정 시점 특정 컬럼 값을 바로 조회 가능).
--        approved_by/approved_at/reject_reason 은 원본 스냅샷 그대로 유지한다 — 이건 "이 행의
--        행위자"가 아니라 그 시점 캠페인 자체의 승인 상태이므로, 승인 이후에 생기는 다른 액션
--        (예: 승인된 캠페인의 STATUS_CHANGE) 로그 행에서도 "그때 누가 승인해뒀었는지" 히스토리로
--        계속 의미가 있다.
--        물리 수정 및 삭제를 허용하지 않음(log_audit과 동일 원칙).
-- created_by / created_by_name / created_at
--  log_audit과 동일한 관례: 캠페인 원본의 created_by 스냅샷이 아니라 "이 로그 행(액션)을 수행한
--  사용자/시각"이다. CREATE 행은 생성자, UPDATE/STATUS_CHANGE 행은 그 수정을 한 사용자를 담는다
--  — 모든 액션 공통으로 행위자를 나타내므로 별도 updated_by 컬럼이 필요 없다.
--  created_by_name은 2026.07.22 조회 API(17_CAMPAIGN_API.md 4.2) 설계 중 추가됨 — 애초 설계
--  시점엔 이 스냅샷 없이 "조회 시점에 created_by로 user 테이블을 조인하면 된다"고 가정했으나,
--  이 로그는 메인 DB와 물리 분리된 로그 DB에 있어 애초에 조인이 불가능하다(1장/log_audit과 동일
--  제약, 잘못된 전제였음). log_audit의 created_by_name과 동일하게 로그 생성 시점 사용자명을
--  스냅샷으로 저장해 조회 시 조인 없이 행위자명을 바로 노출한다.
-- coupon_campaign_id / project_id 등 (FK 없음)
--  log_audit과 동일하게 로그 테이블은 전체 컬럼에 FK 를 걸지 않는다(원본 삭제/변경과 무관하게
--  로그는 그 시점의 값을 그대로 보존해야 하므로).
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `log_coupon_campaign`;
CREATE TABLE `log_coupon_campaign` (
  `idx`						BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '쿠폰 캠페인 로그 ID',
  `action`					TINYINT		UNSIGNED	NOT NULL															COMMENT '작업 유형 (10:CREATE, 20:UPDATE, 30:STATUS_CHANGE, 40:APPROVE, 50:REJECT)',
  `coupon_campaign_id`		BIGINT		UNSIGNED	NOT NULL															COMMENT '원본 캠페인 ID (FK 없음, 로그 원칙)',
  `project_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT '프로젝트 ID (로그 스코핑용, 원본 스냅샷)',
  `name`					VARCHAR(100)			NOT NULL															COMMENT '캠페인명 (원본 스냅샷)',
  `campaign_start`			DATETIME				NOT NULL															COMMENT '사용 가능 시작일시 (원본 스냅샷)',
  `campaign_end`			DATETIME				NOT NULL															COMMENT '사용 가능 종료일시 (원본 스냅샷)',
  `code_type`				TINYINT		UNSIGNED	NOT NULL															COMMENT '코드 발급 방식 (원본 스냅샷)',
  `use_hyphen`				TINYINT		UNSIGNED	NOT NULL															COMMENT '하이픈 포함 여부 (원본 스냅샷)',
  `requested_qty`			INT			UNSIGNED	NOT NULL															COMMENT '목표 발급 수량 (원본 스냅샷)',
  `generated_qty`			INT			UNSIGNED	NOT NULL															COMMENT '실제 발급 수량 (원본 스냅샷)',
  `usable_qty`				INT			UNSIGNED	NOT NULL															COMMENT '실제 사용 가능 수량 (원본 스냅샷)',
  `used_qty`				INT			UNSIGNED	NOT NULL															COMMENT '실제 사용(소모) 수량 (원본 스냅샷)',
  `use_limit_per_user`		INT			UNSIGNED	NOT NULL															COMMENT '동일 유저 재사용 허용 횟수 (원본 스냅샷)',
  `status`					TINYINT		UNSIGNED	NOT NULL															COMMENT '상태 (원본 스냅샷)',
  `approval_status`			TINYINT		UNSIGNED	NOT NULL															COMMENT '승인상태 (원본 스냅샷)',
  `approved_by`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '승인/반려 처리자 ID (원본 스냅샷)',
  `approved_at`				DATETIME							DEFAULT NULL											COMMENT '승인/반려 처리일시 (원본 스냅샷)',
  `reject_reason`			VARCHAR(500)						DEFAULT NULL											COMMENT '반려 사유 (원본 스냅샷)',
  `reward_data`				JSON					NOT NULL															COMMENT '보상 내용 (원본 스냅샷)',
  `created_by`				BIGINT		UNSIGNED	NOT NULL															COMMENT '이 로그 행(액션)을 수행한 사용자 ID',
  `created_by_name`		VARCHAR(50)				DEFAULT NULL														COMMENT '이 로그 행(액션)을 수행한 사용자명 스냅샷 (로그 생성 시점 값 고정, 별도 DB 분리 대비 user 테이블 조인 제거용)',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '이 로그 행(액션)이 발생한 시각',
  PRIMARY KEY (`idx`),
  KEY `ix_campaign` (`coupon_campaign_id`),
  KEY `ix_project_created` (`project_id`,`created_at`),
  KEY `ix_action` (`action`),
  KEY `ix_created_by` (`created_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 캠페인 변경 이력 (coupon_campaign 전체 컬럼 스냅샷 + action, Append-Only)';
SET FOREIGN_KEY_CHECKS = 1;
