# 03_DATABASE_SCHEMA.md

## 개요

Coupon Platform 데이터베이스 스키마 정의 문서

본 문서는 현재 확정된 운영 스키마(company/project/user/user_role/user_session), 쿠폰 도메인 스키마(coupon_campaign/coupon_code/coupon_code_usage), 로그 스키마(log_audit/log_coupon_campaign/log_coupon_use)를 정의한다.

---

# 테이블 목록

## 1. company

플랫폼 이용 회사 정보

### 특징

- `company_code` 전역 UNIQUE — 셀프 가입 시 초대 코드로 사용
- `created_by` / `updated_by` 컬럼 없음 (의도적 설계)

### 상태

| 값  | 설명 |
| --- | ---- |
| 0   | 중지 |
| 1   | 사용 |

---

## 2. project

서비스 프로젝트 정보

### 특징

- `company` 소속, `company_id` 수정 불가
- `project_code`는 `company_id` 범위 내 UNIQUE (전역 UNIQUE 아님)
- 논리 삭제(status) 사용
- `created_by` / `updated_by` 컬럼 없음 (의도적 설계)
- `api_key` / `api_secret` / `api_secret_prev` / `secret_rotated_at` — 게임서버 → 쿠폰서버 방향 S2S 호출 인증용(HMAC 요청 서명, [06_AUTH_SECURITY.md](./06_AUTH_SECURITY.md) 2장 참고)
  - `api_secret`: 현재 사용 중인 Secret의 AES-256-CBC 암호화값(Base64) — 단방향 해시가 아니라 가역 암호화다. 서버가 요청마다 서명을 재계산해 대조해야 해서 원문 복원이 필요하기 때문(평문 자체가 DB에 그대로 저장되는 것은 아님)
  - `api_secret_prev`: 재발급 직후 유예기간(grace period) 동안만 유지되는 직전 Secret 암호화값. 유예기간 경과 시 배치로 `NULL` 처리
  - `secret_rotated_at`: 마지막 Secret 재발급 시각 (`NULL`이면 최초 발급 후 미변경)

### 상태

| 값  | 설명 |
| --- | ---- |
| 0   | 중지 |
| 1   | 사용 |

---

## 3. user

플랫폼 사용자 계정 (회사 소속 사용자)

### 특징

- `requested_project_id` — 회원가입 신청 시점의 프로젝트 ID를 영구 보관(이후 변경 불가)
- 셀프 회원가입 + 승인 프로세스 지원
- `phone_number`는 AES-256-CBC 암호화(Base64) 저장
- `password_hash`는 bcrypt(rounds=12)

### 상태

| 값  | 설명         |
| --- | ------------ |
| 0   | 가입승인대기 |
| 1   | 가입승인     |
| 2   | 가입반려     |
| 3   | 사용중지     |

---

## 4. user_role

사용자 - 프로젝트 권한 매핑 (10단위 role 레벨 코드)

### 특징

- `(user_id, project_id)` 복합 PK
- 논리 삭제(status) 사용

### 권한

| 값  | 설명        |
| --- | ----------- |
| 10  | SUPER_ADMIN |
| 20  | DEVELOPER   |
| 30  | MANAGER     |
| 40  | OPERATOR    |

권한은 상위(숫자가 작을수록 고권한)가 하위 권한을 모두 포함하는 누적 구조다: `SUPER_ADMIN ⊇ DEVELOPER ⊇ MANAGER ⊇ OPERATOR`. 역할별 상세 권한은 [09_COMPANY_API.md](./09_COMPANY_API.md) 1.2 참고.

### 특수 규칙

SUPER_ADMIN은 어떤 프로젝트에 연결되어도 무관함 (전체 접근 권한)

---

## 5. user_session

사용자 인증 세션(Access Token / Refresh Token 기반)

### 특징

- `access_token_jti`(JWT의 jti)를 UNIQUE 키로 관리
- `refresh_token_hash` — refresh token 원문은 저장하지 않고 해시값만 저장
- `user_id`에 FK를 의도적으로 적용하지 않음 — 세션 조회가 `access_token_jti` 기준으로 이뤄져, MySQL → Redis 저장소 전환 시 인증 로직 수정 없이 확장 가능하도록 설계
- `user.status`와 별도로 관리되는 세션 단위 상태

### 상태

| 값  | 설명     |
| --- | -------- |
| 0   | 로그아웃 |
| 1   | 사용     |
| 2   | 만료     |

---

## 6. coupon_campaign

쿠폰 캠페인 정책 정보

### 특징

- `project` 소속. 실제 코드 값은 `code_type` 무관하게 항상 `coupon_code`에만 저장(중복 저장 없음)
- `code_type`(1:RANDOM/2:FIXED)에 따라 코드 발급 방식이 다름 — RANDOM은 `requested_qty`만큼 코드를 대량 생성, FIXED는 관리자 입력 코드 1건만 생성 후 `requested_qty`를 목표 발급 수량으로 기록
- `use_hyphen`은 RANDOM 코드 생성 시에만 적용(하이픈 포함 여부), FIXED는 관리자 입력값을 그대로 사용해 적용 대상 아님
- 수량 컬럼 4종: `requested_qty`(목표 발급) / `generated_qty`(실제 발급) / `usable_qty`(실제 사용 가능, 선착순 오픈 등으로 `generated_qty`보다 적을 수 있음) / `used_qty`(실제 소모, reserve 성공 시점 즉시 확정 기준 — confirm 여부와 무관)
- **동시성(오버셀 방지)**: reserve 시 `UPDATE coupon_campaign SET used_qty=used_qty+1 WHERE used_qty<usable_qty AND status=2 AND NOW() BETWEEN campaign_start AND campaign_end` 조건부 갱신 하나로 수량/상태(활성)/기간을 동시에 원자적으로 체크한다. status/기간 조건을 같은 UPDATE에 포함시키면 관리자의 일시중지/종료 시점과 겹치는 reserve 요청도 추가 비용 없이 함께 막힌다
- **승인 워크플로우(`approval_status`, `status`와 별개 축)**: `status`는 캠페인 라이프사이클(대기/활성/일시중지/종료), `approval_status`는 활성화해도 되는지에 대한 승인 여부다. MANAGER 이상이 생성/컨트롤하면 `approval_status=1`(승인불요)로 즉시 시작, OPERATOR가 생성/컨트롤하면 `approval_status=2`(승인대기)로 시작해 10/20/30이 승인/반려한다. `status`를 2(활성)로 전환하는 SP는 `approval_status IN (1,3)`(승인불요/승인완료)일 때만 허용 — 미승인 캠페인은 애초에 활성 상태에 도달할 수 없으므로 reserve 시점 체크는 `status=2`만 보면 된다. 변경 이력은 `log_coupon_campaign`에 별도 기록
- `reward_data`는 완전 자유 스키마 JSON — 쿠폰서버는 내용을 해석하지 않고 게임서버로 그대로 pass-through
- 쿠폰 코드 생성 규칙(RANDOM 전용): `nanoid.customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 12)().match(/.{1,4}/g)?.join('-')` → `XXXX-XXXX-XXXX` 형식

### 상태 (`status`)

| 값  | 설명     |
| --- | -------- |
| 1   | 대기     |
| 2   | 활성     |
| 3   | 일시중지 |
| 4   | 종료     |

### 승인상태 (`approval_status`)

| 값  | 설명     |
| --- | -------- |
| 1   | 승인불요 |
| 2   | 승인대기 |
| 3   | 승인완료 |
| 4   | 반려     |

미배정 시(SP가 명시적으로 지정 안 하는 경우를 대비한) 컬럼 기본값은 fail-safe 원칙에 따라 **2(승인대기)**.

---

## 7. coupon_code

쿠폰 코드 실물 정보 (RANDOM/FIXED 공통, `coupon_campaign.code_type`에 따라 `status` 의미가 다름)

### 특징

- RANDOM: 코드 1건 = 1회용. reserve 시 `UPDATE coupon_code SET status=사용완료 WHERE coupon_code_id=? AND status=미사용` 조건부 갱신 한 번으로 검증+소모 확정까지 원자적으로 끝난다(별도 예약중 단계 없음, 이 조건부 갱신 자체가 동시 예약을 방지하는 락 역할도 겸함). 코드 문자열은 nanoid 생성규칙을 그대로 사용
- FIXED: 코드 1건을 여러 사용자가 각자 사용. 코드 자체는 사용자별로 소진되지 않으므로 `status`는 "이 코드 자체가 활성 상태인지"만 나타냄(0=관리자가 회수/중지, 1=사용중). 코드 문자열은 관리자가 입력한 값을 그대로 사용(`use_hyphen`과 동일한 원칙 — 시스템이 값을 가공하지 않음)
- 실제 사용자별 소모 이력과 사용 한도 체크는 `coupon_code_usage`에서 처리(`confirmed_at`/`game_user_id` 등은 이 테이블에 두지 않음)
- **`project_id`(비정규화)**: `coupon_campaign_id`로도 조인해 알 수 있지만, `code_value`의 유니크 범위를 프로젝트 단위로 좁히기 위해 직접 보유. FIXED는 관리자가 자유 문자열을 입력하므로 전체 프로젝트 통틀어 유니크로 두면 서로 다른 회사가 같은 문구(예: "SUMMER2024")를 쓰려 할 때 충돌한다 — 유니크 범위를 `(project_id, code_value)`로 좁혀 프로젝트별로만 유일하면 되도록 함. 부수 효과로 reserve 조회(`WHERE project_id=? AND code_value=?`)가 자연스럽게 프로젝트 소속 검증도 겸함

### 상태 (`status`)

| 값  | 설명                              |
| --- | --------------------------------- |
| 0   | 중지                               |
| 1   | 미사용(RANDOM) / 사용중(FIXED)     |
| 2   | 사용완료(RANDOM 전용)              |

---

## 8. coupon_code_usage

쿠폰 코드 사용 기록 (RANDOM/FIXED 공통)

### 특징

- **reserve = 즉시 최종 소모 확정 모델**(IAP consume/acknowledge 패턴과 동일): reserve 성공 시 이 테이블에 행이 생성되는 시점에 이미 소모가 확정된다(`coupon_campaign.used_qty` 원자적 +1, RANDOM은 `coupon_code.status`도 함께 사용완료로 전환). 예약중 상태로 대기했다가 confirm으로 넘어가는 중간 단계는 없음
- `confirm`은 상태를 바꾸지 않는다 — `confirmed_at`에 지급 성공 시각만 기록하는 결과 보고일 뿐. `confirmed_at IS NULL`이면 미컨슘
- confirm이 끝내 오지 않아도 쿠폰서버는 아무것도 자동으로 되돌리지 않는다. 대신 미컨슘 건을 게임서버가 스스로 찾아 재처리할 수 있는 조회 API(`GET /coupons/unconfirmed`, 특정유저/전체유저)를 제공 — 재시도 여부/시점 판단은 전적으로 게임서버 책임(쿠폰서버→게임서버 콜백/웹훅 없음)
- `game_user_id`는 관리콘솔 계정(`user`)과 무관한 별개 신원 체계(게임 플레이어). 게임서버마다 포맷이 다를 수 있어 FK 없이 원문 문자열로 저장
- **`coupon_campaign_id`/`project_id`(비정규화)**: 사용한도 카운트(`COUNT(*) WHERE coupon_campaign_id=? AND game_user_id=?`) 및 미컨슘 조회용. 특히 `project_id`는 `game_user_id` 값이 서로 다른 프로젝트끼리 우연히 겹칠 수 있어(예: 두 게임 모두 "12345") 미컨슘 조회 API의 크로스테넌트 스코핑에 필수 — 없으면 `campaign_id` 필터를 생략한 특정유저 조회 시 다른 프로젝트 데이터가 섞여 나올 수 있음
- **동시성**: 사용자당 한도 체크는 단순 `COUNT` 후 `INSERT`로는 동시 요청 시 한도를 넘길 수 있어, `SELECT COUNT(*) ... WHERE coupon_campaign_id=? AND game_user_id=? FOR UPDATE`로 조회해 `ix_campaign_user` 인덱스 구간에 갭락을 걸어 동시 INSERT를 직렬화한 뒤 판단해야 함
- 상태 컬럼 없음 — 모든 행이 이미 소모 확정 상태이므로 별도 상태값 불필요(`confirmed_at` nullable 하나로 미컨슘 여부 표현)

상세 흐름/동시성 처리/미컨슘 조회 API는 [05_COUPON_USAGE_SCENARIO.md](./05_COUPON_USAGE_SCENARIO.md) 참고.

---

## 9. log_audit

관리 콘솔 계정/테넌시 설정 변경 이력을 저장하는 Append-Only 테이블

### 특징

- 대상은 `company`/`project`/`user`/`user_role` 4개 테이블뿐(시스템관리자 영역). `coupon_campaign`은 `log_coupon_campaign`(플랫폼사용자·운영자 영역), 쿠폰 사용 시도는 `log_coupon_use`(유저 영역)로 별도 관리 — `log_audit`는 SUPER_ADMIN/DEVELOPER만 조회 가능한데 MANAGER/OPERATOR가 직접 다루는 대상을 여기 합치면 작업 당사자가 자기 이력을 볼 수 없게 되므로 영역별로 분리함
- CREATE / UPDATE / STATUS_CHANGE 작업만 기록, 변경 전후 전체 Row를 JSON 형태로 저장(`before_json`/`after_json`)
- `table_name` + `target_id`로 테이블 범용 식별 (복합 PK 대상은 JSON 문자열로 식별, 예: `{"user_id":100,"project_id":200}`)
- 물리 수정 및 삭제를 허용하지 않음(Append-Only)
- `company_id`/`project_id`는 로그 스코핑(조회 필터링)용이며 FK 없음
- `created_by`도 로그 테이블 원칙상 FK 없음
- `created_by_name`은 로그 생성 시점 사용자명 스냅샷(향후 DB 분리 대비 `user` 테이블 조인 제거용)
- `user_session`은 세션 이력 테이블이므로 감사 대상에서 제외

### 작업 유형

| 값  | 설명         |
| --- | ------------ |
| 10  | CREATE       |
| 20  | UPDATE       |
| 30  | STATUS_CHANGE |

---

## 10. log_coupon_campaign

쿠폰 캠페인 변경 이력 — 플랫폼사용자(운영자) 영역 로그 (Append-Only)

### 특징

- `log_audit`와 달리 `coupon_campaign` 전체 컬럼을 그대로 스냅샷으로 복제해 저장한다(`before_json`/`after_json` JSON 방식이 아니라 `coupon_campaign`과 거의 동일한 구조 + `action` 컬럼) — 타입 보존, JSON 파싱 없이 특정 시점 특정 컬럼 값을 바로 조회 가능
- CREATE / UPDATE / STATUS_CHANGE / APPROVE / REJECT 5종 작업 기록
- `approved_by`/`approved_at`/`reject_reason`도 원본 스냅샷 그대로 유지 — "이 행의 행위자"가 아니라 그 시점 캠페인 자체의 승인 상태이므로, 승인 이후에 생기는 다른 액션(예: 승인된 캠페인의 STATUS_CHANGE) 로그 행에서도 "그때 누가 승인해뒀었는지" 히스토리로 계속 의미가 있음
- `created_by`/`created_at`은 `log_audit`와 동일한 관례 — 캠페인 원본의 `created_by` 스냅샷이 아니라 **"이 로그 행(액션)을 수행한 사용자/시각"**이다. CREATE 행은 생성자, UPDATE/STATUS_CHANGE 행은 그 수정을 한 사용자를 담으므로 별도 `updated_by` 컬럼이 필요 없음
- 물리 수정 및 삭제를 허용하지 않음(Append-Only)
- 전체 컬럼 FK 없음(`coupon_campaign_id`/`project_id` 포함) — 로그 원칙(원본 삭제/변경과 무관하게 그 시점 값을 그대로 보존)

### 작업 유형

| 값  | 설명          |
| --- | ------------- |
| 10  | CREATE        |
| 20  | UPDATE        |
| 30  | STATUS_CHANGE |
| 40  | APPROVE       |
| 50  | REJECT        |

---

## 11. log_coupon_use

쿠폰 사용(reserve/confirm) 시도 이력 — 유저 영역 로그 (Append-Only)

### 특징

- `coupon_code_usage`는 성공한 소모 건만 남기지만, 이 테이블은 실패한 시도까지 전부 기록한다(부정사용 탐지: 코드 브루트포스, 한도 우회 시도 등 / 운영 디버깅 목적). RESERVE/CONFIRM 요청 모두 기록 대상
- `code_value`는 FK가 아님 — 존재하지 않는 코드로 시도한 요청도 그대로 남겨야 브루트포스 탐지가 가능하므로 문자열 원문을 그대로 저장
- `coupon_campaign_id`는 NULL 허용 — 코드 자체가 존재하지 않는 시도는 캠페인을 특정할 수 없음
- `result_type`(0:성공, 10:코드없음, 20:이미소모/중지, 30:캠페인 사용불가, 40:사용자한도초과, 50:소모기록없음(CONFIRM 전용))의 API result 코드 매핑은 [17_COUPON_USAGE_API.md](./17_COUPON_USAGE_API.md) 4장 참고
- 물리 수정 및 삭제를 허용하지 않음(Append-Only)
- 전체 컬럼 FK 없음(`project_id`/`coupon_campaign_id`/`code_value` 포함) — 로그 원칙

### 요청 유형

| 값  | 설명    |
| --- | ------- |
| 10  | RESERVE |
| 20  | CONFIRM |

---

## 12. project_api_nonce

S2S(게임서버 → 쿠폰서버) HMAC 요청 서명의 재전송(replay) 방지용 1회성 nonce 저장소([06_AUTH_SECURITY.md](./06_AUTH_SECURITY.md) 2장 참고)

### 특징

- `X-API-Nonce` 헤더값을 서명 검증 통과 후 `(project_id, nonce)` UNIQUE 제약으로 INSERT 시도 — 위반 시 재전송(replay)으로 판단해 거부. INSERT 자체의 유니크 제약을 이용하므로 동시 요청에도 원자적으로 하나만 성공
- 로그 테이블이 아니라 실시간 보안 검증용 기능 테이블이라 `project_id`에 FK를 건다(로그 테이블의 FK 미적용 원칙과 다름)
- 보관 기간이 `S2S_TIMESTAMP_TOLERANCE_SEC`(기본 300초)만 필요해 `log_*` 테이블과 달리 장기 보관하지 않음 — 그 범위를 벗어난 요청은 Timestamp 검증 단계에서 이미 거부되므로 오래된 nonce는 재사용 위협이 없음
- 정리 배치(`S2S_NONCE_CLEANUP_CRON`, 기본 10분 간격)가 `created_at`이 허용범위보다 과거인 행을 물리 삭제 — 세션 정리(1일 1회)보다 훨씬 잦은 이유는 reserve/confirm 호출마다 1행씩 쌓여 테이블이 빠르게 커질 수 있기 때문

---

## 공통 정책

- 물리 삭제 금지 — 논리 삭제(`status` 컬럼)로만 처리
- 목록 조회 시 정렬은 `status DESC` 우선
- SUPER_ADMIN은 전체 접근, 그 외 role은 소속 company/project 범위 내에서만 접근
- 비밀번호는 bcrypt(rounds=12)
