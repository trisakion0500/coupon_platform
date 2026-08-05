-- ------------------------------------------------------------------------------------------------------------ --
-- 로그 DB(coupon_platform_log) 통합 테이블 파일 — database/tables/all_tables.sql과 동일한 목적(로컬 개발 편의용 한 번에 적용).
-- 2026.07.19부터 메인 서비스 DB와 물리적으로 분리된 별도 DB에 적용한다(04_DEV_CONVENTIONS.md 1장 참고).
-- 개별 파일을 수정하면 이 파일도 반드시 함께 갱신할 것(all_tables.sql과 동일한 동기화 원칙).
-- ------------------------------------------------------------------------------------------------------------ --
-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : log_audit
-- 작성 : 2026.07.15 trisakion
-- 내용 : 관리 콘솔 계정/테넌시 설정 변경 이력을 저장하는 Append-Only 테이블
--        CREATE / UPDATE / STATUS_CHANGE 작업 기록
--        변경 전후 전체 Row를 JSON 형태로 저장
--        대상은 company/project/user/user_role 4개 테이블뿐
--        coupon_campaign/coupon_code는 각자 전용 이벤트 로그(log_coupon_campaign, log_coupon_use)로 관리
--        user_session은 세션 이력 테이블이므로 감사 대상에서 제외
--        물리 수정 및 삭제를 허용하지 않음
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `log_audit`;
CREATE TABLE `log_audit` (
  `idx`						BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '감사 로그 ID',
  `action`					TINYINT		UNSIGNED	NOT NULL															COMMENT '작업 유형 (10:CREATE, 20:UPDATE, 30:STATUS_CHANGE)',
  `company_id`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '회사 ID (로그 스코핑용, FK 없음)',
  `project_id`				BIGINT		UNSIGNED				DEFAULT NULL											COMMENT '프로젝트 ID (로그 스코핑용, company/user는 NULL, FK 없음)',
  `table_name`				VARCHAR(100)			NOT NULL															COMMENT '대상 테이블명 (company, project, user, user_role)',
  `target_id`				VARCHAR(100)			NOT NULL															COMMENT '대상 PK 값 또는 복합 PK 식별값 (예: 100, {"user_id":100,"project_id":200})',
  `target_name`				VARCHAR(200)			DEFAULT NULL														COMMENT '대상 표시명 스냅샷 (예: 회사명, 프로젝트명, 사용자명)',
  `before_json`				LONGTEXT				DEFAULT NULL														COMMENT '변경 전 데이터(JSON) (CREATE 시 NULL, UPDATE/STATUS_CHANGE 시 수정 전 Row 전체)',
  `after_json`				LONGTEXT				NOT NULL															COMMENT '변경 후 데이터(JSON) (CREATE/UPDATE/STATUS_CHANGE 시 항상 필수)',
  `created_by`				BIGINT		UNSIGNED	NOT NULL															COMMENT '작업 수행 사용자 ID',
  `created_by_name`			VARCHAR(50)				DEFAULT NULL														COMMENT '작업 수행 사용자명 스냅샷 (로그 생성 시점 값 고정, 별도 DB 분리 대비 user 테이블 조인 제거용)',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '로그 생성일시',
  PRIMARY KEY (`idx`),
  KEY `ix_table_target` (`table_name`, `target_id`),
  KEY `ix_company_id` (`company_id`),
  KEY `ix_project_id` (`project_id`),
  KEY `ix_created_by` (`created_by`),
  KEY `ix_created_at` (`created_at`)
  -- CONSTRAINT `fk_log_audit_created_by` FOREIGN KEY (`created_by`) REFERENCES `user` (`user_id`)	-- 로그테이블이므로 FK 사용하지 않음
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='관리 콘솔 계정/테넌시 설정 변경 감사 로그 (company/project/user/user_role 전용, 변경 전후 전체 Row를 JSON 형태로 저장하는 Append-Only 테이블)';
SET FOREIGN_KEY_CHECKS = 1;
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
--  created_by_name은 2026.07.22 조회 API(19_CAMPAIGN_API.md 4.2) 설계 중 추가됨 — 애초 설계
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
--  API 상세 스펙 및 매핑표: docs/20_COUPON_USAGE_API.md 4장
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
  `result_type`				TINYINT		UNSIGNED	NOT NULL															COMMENT '처리 결과 (0:성공, 10:코드없음, 20:이미소모/중지, 30:캠페인 사용불가, 40:사용자한도초과, 50:소모기록없음(CONFIRM 전용)) — API result 코드 매핑은 docs/20_COUPON_USAGE_API.md 4장 참고',
  `caller_ip`				VARCHAR(45)				DEFAULT NULL											COMMENT '호출한 게임서버의 IP(IPv6 포함, req.ip). 인증 목적 아님 - 이상징후 탐지/장애조사 보조용',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '시도 일시',
  PRIMARY KEY (`idx`),
  KEY `ix_project_created` (`project_id`,`created_at`),
  KEY `ix_code_value` (`code_value`),
  KEY `ix_game_user` (`game_user_id`),
  KEY `ix_result_type` (`result_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 사용(reserve/confirm) 시도 이력 (성공/실패 전체, Append-Only)';
SET FOREIGN_KEY_CHECKS = 1;
