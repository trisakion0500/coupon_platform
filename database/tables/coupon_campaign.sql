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
--  - status를 2(활성)로 전환하는 SP는 approval_status IN (1,3)(승인불요/승인완료) AND
--    campaign_end > NOW()(2026-07-25 추가 - 이미 사용기간이 지난 캠페인이 활성 상태로 진입하는
--    것 자체를 막음, 17_CAMPAIGN_API.md 2.5 참고)일 때만 허용한다.
--    reserve 시점의 조건부 UPDATE(위 동시성 절)는 status=2만 체크하면 되고 approval_status를
--    매번 다시 검사할 필요는 없다 — 애초에 미승인 캠페인은 status=2에 도달할 수 없기 때문.
--  변경 이력(누가 언제 승인/반려했는지)은 log_coupon_campaign에 append-only로 별도 기록한다.
-- 코드 생성 진행상태 (generation_status, status/approval_status와 별개 축)
--  캠페인 생성(POST /campaigns)과 코드 발급(POST /campaigns/{id}/codes)은 별도 API로 분리되어 있다.
--  - RANDOM: 대량생성이라 비동기로 처리 — 1:대기(코드 발급 요청 전) → 2:진행중 → 3:완료 또는 4:실패
--            캠페인당 코드 생성 요청은 1회만 허용(추가 발급/top-up 불가) — job과 campaign이 항상 1:1이라
--            별도 job 테이블 없이 이 컬럼만으로 진행상태를 표현 가능하다.
--  - FIXED: 관리자가 코드 목록을 직접 입력/업로드하는 동기 처리라 진행상태 개념이 없다 —
--           등록 요청 즉시 결과가 나오므로 성공 시 바로 3(완료)으로 기록한다.
--  4(실패)는 "재시도로도 복구 안 된 최종 실패"만 의미한다. 코드값 충돌(nanoid 우연 중복)은 즉시
--  재생성으로 처리하고, DB 커넥션 끊김 등 일시적 오류는 exponential backoff+jitter 재시도 래퍼로
--  흡수한다 — 그 재시도를 다 소진했을 때만 4로 전이하고 generation_error에 사유를 남긴다(개별
--  재시도 시도 자체는 이 컬럼에 남기지 않음, 애플리케이션 로그로 충분).
--  재시도 API(POST /campaigns/{id}/codes/retry)는 4(실패) 상태에서만 허용하며, 이미 생성된
--  generated_qty만큼의 코드는 그대로 두고 남은 수량(requested_qty - generated_qty)만 이어서 생성한다
--  (이미 생성된 코드는 UNIQUE 제약으로 보호되는 정상 데이터라 버릴 이유가 없음).
--  전이는 조건부 UPDATE로 원자성을 보장한다: 예) 재시도 트리거 시
--  "UPDATE coupon_campaign SET generation_status=2 WHERE coupon_campaign_id=? AND generation_status=4"
-- 낙관적 동시성 제어 (edit_count, 2026-07-20 추가)
--  PATCH /campaigns/{id}(SP_CAMPAIGN_UPDATE)는 여러 필드를 한 번에 바꾸고 그 중 일부(승인상태
--  재전환 등)는 "수정 직전 상태"에 따라 분기하는 로직이 있어, 단순 조건부 UPDATE만으로는
--  "그 사이 다른 관리자가 승인/반려/상태변경을 먼저 했는지"까지 못 잡는다. 처음엔 updated_at
--  (자동 갱신 컬럼)을 그대로 낙관적 락 토큰으로 재사용했으나, DATETIME이 초 단위까지만 기록돼
--  같은 초 안에 두 수정이 겹치면(예: 승인 처리 직후 같은 초에 들어온 수정) 값이 안 바뀐 것처럼
--  보여 충돌을 놓치는 사례가 실제로 재현됨 — 그래서 타이밍에 전혀 의존하지 않는 전용 정수
--  카운터를 별도로 둔다. 이 캠페인 행을 바꾸는 SP(UPDATE/CHANGE_STATUS/APPROVE/REJECT) 전부가
--  성공 시 `edit_count = edit_count + 1`을 실행하고, 클라이언트는 마지막으로 조회했을 때 받은
--  값을 요청에 그대로 실어 보낸다 — SP는 WHERE절에 `edit_count = 받아온 값`을 조건으로 걸어,
--  그 사이 이 행을 건드린 SP가 하나라도 있었다면(어떤 필드가 바뀌었든) 정확히 감지해 30005
--  (동시 수정 충돌)로 거부한다. MySQL의 행 단위 락이 UPDATE 간 순서를 직렬화해주므로 두 요청이
--  아무리 가깝게 들어와도 이 값 하나로 충돌을 확실하게 잡을 수 있다(17_CAMPAIGN_API.md 2.4
--  Concurrency 참고).
-- 사용기간 만료 자동 종료 (SP_CAMPAIGN_EXPIRE, 2026-07-25 추가)
--  status=2(활성) AND approval_status IN(1,3) AND campaign_end<=NOW()인 캠페인을 배치
--  (CampaignExpiryService, CAMPAIGN_EXPIRY_CRON)가 주기적으로 status=4(종료)로 전환한다 —
--  기간이 지났는데도 화면엔 "활성"으로 남아있는 상태를 없애기 위함(reserve는 이미 자체
--  시간조건으로 막혀있어 정합성 문제는 아니고 순수 표시 문제). status=1(대기)은 대상이
--  아니다 — 관리자가 나중에 쓰려고 일부러 활성화하지 않은 캠페인까지 건드리지 않는다.
--  updated_by는 NULL로 남기지만(이 컬럼은 원래 nullable), log_coupon_campaign.created_by는
--  NOT NULL이라 배치는 created_by=0/created_by_name='SYSTEM' sentinel로 기록한다(사람이 아닌
--  시스템이 한 액션이라는 뜻, 02_DEV_CONVENTIONS.md 4.2). 상세는 17_CAMPAIGN_API.md 5장,
--  SP_CAMPAIGN_EXPIRE 헤더 주석 참고. 이 조건에 맞는 후보를 빠르게 찾기 위해
--  ix_status_campaign_end(status, campaign_end) 인덱스를 함께 추가했다.
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
  `generation_status`		TINYINT		UNSIGNED	NOT NULL	DEFAULT 1												COMMENT '코드 생성 진행상태 (1:대기, 2:진행중, 3:완료, 4:실패) — status/approval_status와 별개 축, FIXED는 동기 처리라 등록 즉시 3으로 확정',
  `generation_error`		VARCHAR(500)						DEFAULT NULL											COMMENT '코드 생성 최종 실패 사유 (재시도 소진 시에만 기록)',
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
  `edit_count`				INT			UNSIGNED	NOT NULL	DEFAULT 0												COMMENT '낙관적 동시성 제어용 수정 횟수(매 수정마다 +1, PATCH 요청은 이 값을 그대로 실어 보내야 함 - 위 헤더 주석 참고)',
  PRIMARY KEY (`coupon_campaign_id`),
  KEY `ix_project_status` (`project_id`,`status`),
  KEY `ix_project_approval_status` (`project_id`,`approval_status`),
  KEY `ix_project_generation_status` (`project_id`,`generation_status`),
  KEY `ix_code_type` (`code_type`),
  KEY `ix_status_campaign_end` (`status`,`campaign_end`),
  CONSTRAINT `fk_coupon_campaign_project` FOREIGN KEY (`project_id`) REFERENCES `project` (`project_id`),
  CONSTRAINT `fk_coupon_campaign_created_by` FOREIGN KEY (`created_by`) REFERENCES `user` (`user_id`),
  CONSTRAINT `fk_coupon_campaign_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `user` (`user_id`),
  CONSTRAINT `fk_coupon_campaign_approved_by` FOREIGN KEY (`approved_by`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='쿠폰 캠페인 정책 정보';
SET FOREIGN_KEY_CHECKS = 1;
