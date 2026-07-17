-- ------------------------------------------------------------------------------------------------------------ --
-- 명칭 : coupon_code_usage
-- 작성 : 2026.07.17 trisakion
-- 내용 : 쿠폰 코드 사용 기록 (RANDOM/FIXED 공통)
--        game_user_id 는 coupon_platform 의 관리콘솔 계정(`user`)과 무관한 별개 신원 체계.
--        실제 쿠폰을 쓰는 주체는 게임 플레이어이며 그 계정 정보는 게임서버 DB에만 존재하므로
--        FK 없이 게임서버가 S2S 호출 시 넘겨주는 식별자 원문을 문자열로 그대로 저장한다
--        (게임서버마다 포맷이 다를 수 있어 공통 포맷으로 강제하지 않음).
-- 흐름 (IAP consume/acknowledge 패턴과 동일)
--  1. reserve  : 사용가능 여부(코드 유효성/사용자당 한도) 검증 통과 시 이 테이블에 행 생성 = 즉시 최종 소모 확정
--                (coupon_campaign.used_qty 도 이 시점에 함께 +1, RANDOM은 coupon_code.status 도 함께 사용완료로 전환)
--  2. (게임서버가 자기 DB에서 실제 보상 지급 처리)
--  3. confirm  : 지급 성공 확인 시점에 confirmed_at 만 기록(상태 전이 아님, 이미 1번에서 소모 확정 끝난 뒤의 결과 기록)
--  4. confirm 이 안 오는 경우에도 쿠폰서버는 되돌리거나 배치를 돌리지 않는다.
--     대신 confirmed_at IS NULL 인 행을 조회하는 API(GET /coupons/unconfirmed, 특정유저/전체유저)를 제공하고,
--     재시도 여부/시점 판단은 전적으로 게임서버 책임이다(쿠폰서버→게임서버 콜백/웹훅 없음).
-- 사용한도 체크 (동시성 주의)
--  coupon_campaign.use_limit_per_user 대비 COUNT(*) WHERE coupon_campaign_id=? AND game_user_id=?
--  (모든 행이 이미 소모 확정 상태이므로 상태값 필터 불필요, RANDOM/FIXED 공통 로직)
--  단, 단순 COUNT 후 INSERT 는 동시 요청 시 한도를 넘길 수 있으므로 반드시
--  "SELECT COUNT(*) ... WHERE coupon_campaign_id=? AND game_user_id=? FOR UPDATE" 로 조회해
--  ix_campaign_user 인덱스 구간에 갭락을 걸어 동시 INSERT 를 직렬화한 뒤 판단해야 한다.
-- project_id (비정규화)
--  game_user_id 는 게임서버가 자체 부여하는 값이라 서로 다른 프로젝트끼리 우연히 겹칠 수 있다
--  (예: 두 게임 모두 플레이어ID로 "12345" 사용). coupon_campaign_id 만으로는 미컨슘 조회 API
--  (GET /coupons/unconfirmed)에서 campaign_id 필터를 생략한 특정유저 조회 시 스코핑할 방법이
--  없어, 다른 프로젝트의 game_user_id 데이터가 섞여 나오는 크로스테넌트 유출 위험이 있다.
--  project_id 를 직접 두면 모든 조회를 "WHERE project_id=? AND ..."로 통일할 수 있고,
--  설령 다른 프로젝트 소속 campaign_id 를 실수로/의도적으로 넘겨도 0건으로 자연스럽게 막힌다.
-- ------------------------------------------------------------------------------------------------------------ --
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `coupon_code_usage`;
CREATE TABLE `coupon_code_usage` (
  `coupon_code_usage_id`	BIGINT		UNSIGNED	NOT NULL	AUTO_INCREMENT											COMMENT '쿠폰 코드 사용 기록 ID',
  `coupon_code_id`			BIGINT		UNSIGNED	NOT NULL															COMMENT '쿠폰 코드 ID (coupon_code.coupon_code_id)',
  `coupon_campaign_id`		BIGINT		UNSIGNED	NOT NULL															COMMENT '캠페인 ID (coupon_campaign.coupon_campaign_id, 사용한도 카운트/미컨슘 조회용 비정규화)',
  `project_id`				BIGINT		UNSIGNED	NOT NULL															COMMENT '소속 프로젝트 ID (project.project_id, coupon_code에서 비정규화 — 미컨슘 조회 API의 크로스테넌트 스코핑용)',
  `game_user_id`			VARCHAR(100)			NOT NULL															COMMENT '게임서버 유저 식별자(원문 문자열 저장, 포맷은 게임서버마다 상이, FK 없음)',
  `confirmed_at`			DATETIME							DEFAULT NULL											COMMENT '지급 성공 확인일시(confirm 완료 시점). NULL이면 미컨슘',
  `created_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP								COMMENT '생성일시(=소모 확정일시)',
  `updated_at`				DATETIME				NOT NULL	DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP	COMMENT '수정일시',
  PRIMARY KEY (`coupon_code_usage_id`),
  KEY `ix_code_id` (`coupon_code_id`),
  KEY `ix_campaign_user` (`coupon_campaign_id`,`game_user_id`),
  KEY `ix_campaign_confirmed` (`coupon_campaign_id`,`confirmed_at`),
  KEY `ix_project_user_confirmed` (`project_id`,`game_user_id`,`confirmed_at`),
  KEY `ix_project_confirmed` (`project_id`,`confirmed_at`),
  CONSTRAINT `fk_coupon_code_usage_code` FOREIGN KEY (`coupon_code_id`) REFERENCES `coupon_code` (`coupon_code_id`),
  CONSTRAINT `fk_coupon_code_usage_campaign` FOREIGN KEY (`coupon_campaign_id`) REFERENCES `coupon_campaign` (`coupon_campaign_id`),
  CONSTRAINT `fk_coupon_code_usage_project` FOREIGN KEY (`project_id`) REFERENCES `project` (`project_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 코드 사용 기록 (reserve=즉시 소모 확정, confirm=지급 결과 기록)';
SET FOREIGN_KEY_CHECKS = 1;
